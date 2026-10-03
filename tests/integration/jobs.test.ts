import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { ABSENT_RECHECK_DAYS } from '@/services/catalogue/artwork-staleness';
import { singleArtistAlbum, yearOnlyAlbum } from '@/services/catalogue/fixtures';
import {
  drainJobs,
  enqueueJob,
  enqueueFailedExpansions,
  enqueueMissingArtwork,
  enqueueMissingArtistAliases,
  enqueueStaleTracklists,
  queueDepth,
  reclaimStaleJobs,
} from '@/services/catalogue/jobs';
import * as ingest from '@/services/catalogue/ingest';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import * as artwork from '@/services/catalogue/artwork';
import * as mb from '@/services/catalogue/musicbrainz';
import { fetchAndStoreArtistAliases } from '@/services/catalogue/aliases';
import { ARTWORK_BUCKET } from '@/services/catalogue/artwork';
import { sleep } from '@/services/catalogue/rate-limiter';
import {
  BULK_ARTWORK_PRIORITY,
  DEFAULT_JOB_PRIORITY,
  INTERACTIVE_JOB_PRIORITY,
} from '@/services/catalogue/queue';

/**
 * Job queue against the real database.
 *
 * The work each job performs is stubbed at the service boundary; what is under
 * test here is the queue itself — claiming, retry, backoff, exhaustion and the
 * partial unique index.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const MBID_A = singleArtistAlbum.id;
const MBID_B = '0b0e4f1e-1111-4000-8000-0000000000bb';

async function clear() {
  await admin.from('ingestion_jobs').delete().gte('id', 0);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(clear);
afterEach(() => vi.restoreAllMocks());
afterAll(clear);

/** Succeeds without touching MusicBrainz. */
function stubIngestSuccess() {
  vi.spyOn(ingest, 'ingestReleaseGroup').mockResolvedValue({
    status: 'ingested',
    albumId: 'stub',
    mbid: MBID_A,
  });
  vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({ status: 'found', sizes: [500] });
}

describe('enqueueJob', () => {
  it('queues a job as pending', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const { data } = await admin.from('ingestion_jobs').select('*').single();
    expect(data).toMatchObject({ status: 'pending', attempts: 0, kind: 'ingest_release_group' });
  });

  it('ignores a duplicate for the same kind and target', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(1);
  });

  it('allows different kinds for the same target', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(2);
  });

  it('allows re-queueing once the earlier job has completed', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await admin.from('ingestion_jobs').update({ status: 'succeeded' }).gte('id', 0);

    // The unique index is partial on pending/running, so a later re-sync is
    // not blocked by history.
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(2);
  });
});

/**
 * The claim function's cardinality, against the real database.
 *
 * **These exist because the contract was violated in production conditions.**
 * CI observed `claim_ingestion_jobs` called with `batch_size := 1` returning
 * three rows, ten times in one run, which left two jobs `running` with their
 * attempt spent and nothing scheduled to recover them for ninety minutes
 * (`20260831120000_enforce_claim_batch_size.sql`).
 *
 * The first case is the regression test for that defect. It needs **three**
 * eligible jobs: `self-service.test.ts` already asserted a single-row claim,
 * but with only two pending rows, and it passed throughout — the old
 * implementation over-returned only under conditions two rows did not reach.
 */
describe('claim_ingestion_jobs cardinality', () => {
  async function claim(batchSize: number) {
    const { data, error } = await admin.rpc('claim_ingestion_jobs', { batch_size: batchSize });
    if (error) throw error;
    return data ?? [];
  }

  it('returns exactly one of three eligible jobs for batch_size 1', async () => {
    for (let i = 0; i < 3; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000d0${i}0`, { admin });
    }

    const claimed = await claim(1);

    expect(claimed).toHaveLength(1);
    expect(await queueDepth(admin)).toMatchObject({ pending: 2, running: 1 });
  });

  it('returns exactly two of five eligible jobs for batch_size 2', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000d1${i}0`, { admin });
    }

    const claimed = await claim(2);

    expect(claimed).toHaveLength(2);
    expect(await queueDepth(admin)).toMatchObject({ pending: 3, running: 2 });
  });

  it('still claims the lowest priority value first', async () => {
    await enqueueJob('fetch_artwork', MBID_A, { admin, priority: 200 });
    await enqueueJob('fetch_artwork', MBID_B, { admin, priority: 10 });

    const claimed = await claim(1);

    expect(claimed).toHaveLength(1);
    expect(claimed[0].target_mbid).toBe(MBID_B);
  });

  it('marks every row it returns, and only those', async () => {
    for (let i = 0; i < 4; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000d2${i}0`, { admin });
    }

    const claimed = await claim(2);
    const ids = claimed.map((row) => row.id).sort();

    const { data: running } = await admin
      .from('ingestion_jobs')
      .select('id')
      .eq('status', 'running');

    expect(running!.map((row) => row.id).sort()).toEqual(ids);
    expect(claimed.every((row) => row.attempts === 1)).toBe(true);
  });
});

/**
 * The drain's defence against a claim boundary that breaks its contract.
 *
 * The database now enforces the cardinality, so this can no longer be reached
 * through the real function. It is reached the way the suite reaches every
 * other boundary — through the `admin` client the caller already accepts,
 * delegating everything except the one call under test. No production seam was
 * added to make this testable.
 *
 * What matters is the invariant rather than the exception: **a row the drain
 * caused to enter `running` must never be left there silently.**
 */
describe('drainJobs guards the claim contract', () => {
  /** The real client, with one over-returning claim spliced in. */
  function overReturningAdmin(rows: number) {
    return new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== 'rpc') return Reflect.get(target, prop, receiver);
        return async (fn: string, args: { batch_size: number }) => {
          if (fn !== 'claim_ingestion_jobs') return admin.rpc(fn as never, args as never);
          return admin.rpc('claim_ingestion_jobs', { batch_size: rows });
        };
      },
    }) as typeof admin;
  }

  it('releases every claimed row and reports the violation', async () => {
    stubIngestSuccess();
    for (let i = 0; i < 3; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000d3${i}0`, { admin });
    }

    await expect(drainJobs(10, overReturningAdmin(3))).rejects.toThrow(
      /returned 3 rows for batch_size 1/,
    );

    // The whole point: nothing is left stranded in `running`.
    expect(await queueDepth(admin)).toMatchObject({ pending: 3, running: 0, succeeded: 0 });
  });

  it('keeps the attempt that the claim spent', async () => {
    stubIngestSuccess();
    for (let i = 0; i < 2; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000d4${i}0`, { admin });
    }

    await expect(drainJobs(10, overReturningAdmin(2))).rejects.toThrow();

    const { data } = await admin.from('ingestion_jobs').select('status, attempts');

    // Released, not rewritten: the attempt really was spent, and hiding it
    // would make the retry budget lie.
    expect(data!.every((row) => row.status === 'pending' && row.attempts === 1)).toBe(true);
  });

  /**
   * A client whose Nth *release* update fails.
   *
   * `reclaimStaleJobs` also updates this table at the top of every drain, so
   * releases are identified by their payload — `{ status }` alone, where the
   * reclaim sends `last_error` too — rather than by call order, which would
   * make the test depend on how many updates happen to precede it.
   */
  function releaseFailingAdmin(rows: number, failOnNthRelease: number) {
    let releases = 0;
    const failed = {
      eq: () => failed,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'injected release failure' } }).then(
          resolve,
        ),
    };

    return new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop === 'rpc') {
          return async (fn: string, args: { batch_size: number }) =>
            fn === 'claim_ingestion_jobs'
              ? admin.rpc('claim_ingestion_jobs', { batch_size: rows })
              : admin.rpc(fn as never, args as never);
        }
        if (prop !== 'from') return Reflect.get(target, prop, receiver);

        return (table: string) => {
          const real = admin.from(table as never);
          if (table !== 'ingestion_jobs') return real;

          return new Proxy(real, {
            get(t, p, r) {
              if (p !== 'update') return Reflect.get(t, p, r);
              return (values: Record<string, unknown>) => {
                const isRelease = Object.keys(values).length === 1 && 'status' in values;
                if (!isRelease) return (real as { update: (v: unknown) => unknown }).update(values);
                releases += 1;
                if (releases === failOnNthRelease) return failed;
                return (real as { update: (v: unknown) => unknown }).update(values);
              };
            },
          });
        };
      },
    }) as typeof admin;
  }

  it('attempts every release even when one fails, and says which failed', async () => {
    stubIngestSuccess();
    for (let i = 0; i < 3; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000d6${i}0`, { admin });
    }

    // The first release fails. The two after it must still be attempted — a
    // loop that threw immediately would leave them `running`, which is the
    // exact silent stranding this guard exists to prevent.
    await expect(drainJobs(10, releaseFailingAdmin(3, 1))).rejects.toThrow(
      /could not release .*injected release failure/,
    );

    const depth = await queueDepth(admin);

    // Two released, one left running because its release genuinely failed —
    // and the error above named it rather than hiding the partial cleanup.
    expect(depth).toMatchObject({ pending: 2, running: 1, succeeded: 0 });
  });

  it('processes no surplus work', async () => {
    const spy = vi.spyOn(artwork, 'fetchAndStoreArtwork');
    for (let i = 0; i < 3; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000d5${i}0`, { admin });
    }

    await expect(drainJobs(10, overReturningAdmin(3))).rejects.toThrow();

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('drainJobs', () => {
  it('runs a queued job and marks it succeeded', async () => {
    stubIngestSuccess();
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    // Capped at one job so this stays a test about settling a single job. An
    // ingest queues artwork, and per-job claiming would otherwise run that too
    // in the same invocation — deliberate behaviour, covered on its own below.
    const summary = await drainJobs(1, admin);

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect(await queueDepth(admin)).toMatchObject({ succeeded: 1, pending: 1 });
  });

  it('queues artwork as a follow-up job after a successful ingest', async () => {
    stubIngestSuccess();
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    // One job: this asserts the follow-up is *queued*, so it must not also run.
    await drainJobs(1, admin);

    // Separate job so a Cover Art Archive failure cannot fail metadata that
    // already succeeded.
    const { data } = await admin
      .from('ingestion_jobs')
      .select('kind, status')
      .eq('kind', 'fetch_artwork')
      .single();
    expect(data).toMatchObject({ kind: 'fetch_artwork', status: 'pending' });
  });

  it('treats an out-of-scope release group as success, with no artwork follow-up', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockResolvedValue({
      status: 'out_of_scope',
      mbid: MBID_A,
      reason: 'primary type "single" is out of scope',
    });
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    // Refusing a single is the system working, not a failure to retry.
    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'fetch_artwork');
    expect(count).toBe(0);
  });

  it('returns a failed job to pending with a future run_after', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('upstream exploded'));
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const summary = await drainJobs(10, admin);
    expect(summary).toMatchObject({ failed: 1, exhausted: 0 });

    const { data } = await admin.from('ingestion_jobs').select('*').single();
    expect(data?.status).toBe('pending');
    expect(data?.attempts).toBe(1);
    expect(data?.last_error).toContain('upstream exploded');
    expect(new Date(data!.run_after).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not claim a job whose backoff has not elapsed', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('nope'));
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await drainJobs(10, admin);

    const second = await drainJobs(10, admin);
    expect(second.claimed).toBe(0);
  });

  it('gives up after max_attempts and marks the job failed', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('always fails'));
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    // Three attempts, clearing the backoff between each.
    //
    // Backdated by a minute rather than set to "now": the app and the database
    // run on different clocks, and skew of a few milliseconds is enough to make
    // `run_after <= now()` false and the job unclaimable. That made this test
    // flaky roughly one run in three.
    for (let i = 0; i < 3; i++) {
      await admin
        .from('ingestion_jobs')
        .update({ run_after: new Date(Date.now() - 60_000).toISOString() })
        .gte('id', 0);
      await drainJobs(10, admin);
    }

    const { data } = await admin.from('ingestion_jobs').select('status, attempts').single();
    expect(data).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('respects priority order', async () => {
    stubIngestSuccess();
    await enqueueJob('fetch_artwork', MBID_B, { admin, priority: 200 });
    await enqueueJob('fetch_artwork', MBID_A, { admin, priority: 1 });

    await drainJobs(1, admin);

    const { data } = await admin
      .from('ingestion_jobs')
      .select('target_mbid, status')
      .eq('status', 'succeeded');
    expect(data).toHaveLength(1);
    expect(data?.[0].target_mbid).toBe(MBID_A);
  });

  it('claims nothing when the queue is empty', async () => {
    expect(await drainJobs(10, admin)).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      exhausted: 0,
      reclaimed: 0,
      superseded: 0,
      stoppedBecause: 'drained',
    });
  });

  it('does not hand the same job to two concurrent drains', async () => {
    stubIngestSuccess();
    for (let i = 0; i < 6; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000c0${i}0`, { admin });
    }

    // Duplicated work here means wasted requests against a one-per-second
    // budget, so `for update skip locked` has to hold under concurrency.
    const [first, second] = await Promise.all([drainJobs(6, admin), drainJobs(6, admin)]);

    expect(first.claimed + second.claimed).toBe(6);
  });

  it('stops at maxJobs with work still queued', async () => {
    stubIngestSuccess();
    for (let i = 0; i < 3; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000e0${i}0`, { admin });
    }

    const summary = await drainJobs(2, admin);

    expect(summary).toMatchObject({ claimed: 2, succeeded: 2, stoppedBecause: 'max_jobs' });
    expect(await queueDepth(admin)).toMatchObject({ pending: 1, running: 0 });
  });

  it('claims a follow-up job queued during the same invocation', async () => {
    // An approved consequence of per-job claiming, not an accident: the claim
    // for job two happens after job one has run, so work that job one queued is
    // visible to it. `maxJobs` therefore bounds jobs actually processed, not
    // jobs pending when the drain began. See docs/architecture.md §7.
    stubIngestSuccess();
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    expect(summary).toMatchObject({ claimed: 2, succeeded: 2, stoppedBecause: 'drained' });
    // The ingest, and the artwork job the ingest queued.
    expect(await queueDepth(admin)).toMatchObject({ succeeded: 2, pending: 0, running: 0 });
  });
});

// ---------------------------------------------------------------------------
// One job at a time
//
// The structural property this cycle exists for. Claiming used to mark a whole
// batch `running` before any of it had run, so a worker killed mid-loop
// abandoned every unreached row — 4 a night on staging, at a 60-second ceiling
// and jobs averaging 9 seconds.
//
// This is asserted from *inside* the executing job rather than inferred from
// what a drain produced. An in-process test cannot kill its own worker, and
// throwing from a runner is not an interruption — the failure path settles the
// row. Observing the table mid-drain is the only honest proof.
// ---------------------------------------------------------------------------

describe('one job at a time', () => {
  const MBIDS = [0, 1, 2].map((i) => `0b0e4f1e-1111-4000-8000-00000000d0${i}0`);

  async function runningCount() {
    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'running');
    return count ?? 0;
  }

  it('never has more than one job running at a time', async () => {
    const observed: number[] = [];

    // fetch_artwork deliberately: it queues no follow-up work, so this measures
    // the claiming shape and nothing else.
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockImplementation(async () => {
      observed.push(await runningCount());
      return { status: 'found', sizes: [500] };
    });

    for (const mbid of MBIDS) await enqueueJob('fetch_artwork', mbid, { admin });

    await drainJobs(3, admin);

    // Batch claiming produced [3, 3, 3] here. That is the defect, seen directly.
    expect(observed).toEqual([1, 1, 1]);
  });

  it('leaves nothing running once the drain returns', async () => {
    stubIngestSuccess();
    for (const mbid of MBIDS) await enqueueJob('fetch_artwork', mbid, { admin });

    await drainJobs(3, admin);

    expect(await runningCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The drain budget
//
// Bounds what a drain *starts*, never what it has already begun. The residual
// this cannot remove is a single job longer than the remaining budget, which is
// covered here as intended behaviour rather than left untested.
// ---------------------------------------------------------------------------

describe('drain budget', () => {
  const MBIDS = [0, 1, 2, 3].map((i) => `0b0e4f1e-1111-4000-8000-00000000f0${i}0`);

  async function jobRows() {
    const { data } = await admin.from('ingestion_jobs').select('status, attempts').order('id');
    return data ?? [];
  }

  /**
   * The load-bearing budget test, and the mutation target.
   *
   * `budgetMs: 0` is a caller with no time left. Nothing may be claimed — and
   * `attempts` is what proves it: a row never claimed carries 0, a row claimed
   * and then abandoned carries 1. Status alone cannot tell those apart, which is
   * precisely why stranded jobs were invisible for so long.
   *
   * Deterministic by construction: no timing, no sleeping, no clock injection.
   */
  it('claims nothing when the budget is already spent', async () => {
    stubIngestSuccess();
    for (const mbid of MBIDS) await enqueueJob('fetch_artwork', mbid, { admin });

    const summary = await drainJobs(10, admin, { budgetMs: 0 });

    expect(summary).toMatchObject({ claimed: 0, succeeded: 0, stoppedBecause: 'budget' });

    const rows = await jobRows();
    expect(rows).toHaveLength(MBIDS.length);
    // Untouched, not merely unfinished.
    expect(rows.every((row) => row.status === 'pending')).toBe(true);
    expect(rows.every((row) => row.attempts === 0)).toBe(true);
  });

  it('leaves the jobs it did not reach pending and unclaimed', async () => {
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockImplementation(async () => {
      await sleep(80);
      return { status: 'found', sizes: [500] };
    });
    for (const mbid of MBIDS) await enqueueJob('fetch_artwork', mbid, { admin });

    const summary = await drainJobs(10, admin, { budgetMs: 120 });

    expect(summary.stoppedBecause).toBe('budget');

    const rows = await jobRows();
    const untouched = rows.filter((row) => row.status === 'pending');
    // Asserted on the set rather than an exact count: the number that fits in
    // the budget depends on machine speed, but every row left behind must be
    // pristine whatever that number is.
    expect(untouched.length).toBeGreaterThan(0);
    expect(untouched.every((row) => row.attempts === 0)).toBe(true);
    expect(rows.some((row) => row.status === 'running')).toBe(false);
  });

  it('lets a job already claimed finish past the budget', async () => {
    // The accepted limitation, pinned as intended behaviour. The budget governs
    // whether to start work, and never interrupts work in flight — which is why
    // a job longer than its worker's life can still strand.
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockImplementation(async () => {
      await sleep(300);
      return { status: 'found', sizes: [500] };
    });
    await enqueueJob('fetch_artwork', MBIDS[0], { admin });

    const summary = await drainJobs(10, admin, { budgetMs: 50 });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    const [row] = await jobRows();
    expect(row.status).toBe('succeeded');
  });

  it('reports a drained queue rather than a budget stop when work runs out', async () => {
    stubIngestSuccess();
    await enqueueJob('fetch_artwork', MBIDS[0], { admin });

    const summary = await drainJobs(10, admin, { budgetMs: 30_000 });

    expect(summary).toMatchObject({ claimed: 1, stoppedBecause: 'drained' });
  });

  it('treats an absent budget as no deadline at all', async () => {
    stubIngestSuccess();
    for (const mbid of MBIDS) await enqueueJob('fetch_artwork', mbid, { admin });

    const summary = await drainJobs(10, admin);

    expect(summary).toMatchObject({ claimed: 4, succeeded: 4, stoppedBecause: 'drained' });
  });
});

// ---------------------------------------------------------------------------
// Artwork lifecycle
//
// The seed left 36 albums at artwork_status 'pending' with no job queued and
// nothing scheduled to notice. The cause was subtler than a missing feature:
// fetchAndStoreArtwork records its outcome and returns rather than throwing —
// correct, so a Cover Art Archive problem cannot fail a metadata ingest that
// succeeded — but the job runner ignored the returned status, so a failed fetch
// marked the job 'succeeded' and no retry was ever scheduled.
//
// These cover the whole path: failure, retry, and settling as found or absent.
// ---------------------------------------------------------------------------

/** Clears a job's backoff so the next drain can claim it. */
async function clearBackoff() {
  // Backdated rather than set to now: app and database clocks differ by enough
  // to make `run_after <= now()` false, which made an earlier test flaky.
  await admin
    .from('ingestion_jobs')
    .update({ run_after: new Date(Date.now() - 60_000).toISOString() })
    .gte('id', 0);
}

async function artworkStatusOf(mbid: string) {
  const { data } = await admin.from('albums').select('artwork_status').eq('mbid', mbid).single();
  return data?.artwork_status;
}

async function artworkJob() {
  const { data } = await admin
    .from('ingestion_jobs')
    .select('status, attempts, last_error')
    .eq('kind', 'fetch_artwork')
    .single();
  return data;
}

describe('artwork job failure and retry', () => {
  it('returns the job to pending when the fetch fails, rather than marking it succeeded', async () => {
    // The exact regression. fetchAndStoreArtwork returns 'failed' without
    // throwing; the runner used to discard that and call the job a success.
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'failed',
      reason: 'Cover Art Archive returned 500 for abc (250)',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    expect(summary).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    const job = await artworkJob();
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job?.last_error).toContain('Cover Art Archive returned 500');
  });

  it('schedules the retry into the future rather than immediately', async () => {
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'failed',
      reason: 'transient',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });
    await drainJobs(10, admin);

    const { data } = await admin.from('ingestion_jobs').select('run_after').single();
    expect(new Date(data!.run_after).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not retry an absent cover — Cover Art Archive answered', async () => {
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'absent',
      reason: 'Cover Art Archive holds no front cover',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    // Absence is a settled fact about the artwork, not a failure to reach it.
    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    expect((await artworkJob())?.status).toBe('succeeded');
  });

  it('gives up after max_attempts and leaves the job failed', async () => {
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'failed',
      reason: 'Cover Art Archive returned 500',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    for (let i = 0; i < 3; i++) {
      await clearBackoff();
      await drainJobs(10, admin);
    }

    // Exhaustion is surfaced, not silent: the job stops on its own and a
    // recovery sweep is a deliberate act.
    expect(await artworkJob()).toMatchObject({ status: 'failed', attempts: 3 });
  });
});

describe('artwork lifecycle end to end', () => {
  /**
   * Intercepts Cover Art Archive only. supabase-js talks to the database over
   * fetch too, so a blanket stub breaks every query in the test.
   */
  function stubCoverArt(behaviour: () => Response) {
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('coverartarchive.org')) return behaviour();
      return realFetch(input as RequestInfo, init);
    });
  }

  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
  const serverError = () => new Response('upstream error', { status: 500 });
  const image = () =>
    new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  const noCover = () => new Response(null, { status: 404 });

  afterEach(async () => {
    const { data } = await admin.storage.from(ARTWORK_BUCKET).list();
    for (const entry of data ?? []) {
      const { data: inner } = await admin.storage.from(ARTWORK_BUCKET).list(entry.name);
      await admin.storage
        .from(ARTWORK_BUCKET)
        .remove((inner ?? []).map((f) => `${entry.name}/${f.name}`));
    }
  });

  it('moves failed → retry → found, with the album and the job agreeing', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    // Attempt one: Cover Art Archive is down.
    stubCoverArt(serverError);
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('failed');
    expect((await artworkJob())?.status).toBe('pending');

    // Attempt two: it recovers.
    vi.restoreAllMocks();
    stubCoverArt(image);
    await clearBackoff();
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('found');
    expect((await artworkJob())?.status).toBe('succeeded');
  });

  it('moves failed → retry → absent when the recovered service holds no cover', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    stubCoverArt(serverError);
    await drainJobs(10, admin);
    expect(await artworkStatusOf(MBID_A)).toBe('failed');

    vi.restoreAllMocks();
    stubCoverArt(noCover);
    await clearBackoff();
    await drainJobs(10, admin);

    // A failure that resolves to absence is still a resolution. What must never
    // happen is the reverse: absence recorded while the service was unreachable.
    expect(await artworkStatusOf(MBID_A)).toBe('absent');
    expect((await artworkJob())?.status).toBe('succeeded');
  });

  it('is idempotent — draining the same album twice changes nothing', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });
    stubCoverArt(image);

    await drainJobs(10, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('found');
    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'fetch_artwork')
      .eq('status', 'succeeded');
    expect(count).toBe(2);
  });
});

describe('enqueueMissingArtwork', () => {
  /**
   * **`artwork_updated_at` is set alongside the status, because production
   * always does.** `fetchAndStoreArtwork` stamps it on every attempt including
   * absence, so an `absent` row with no timestamp is a state the product does
   * not produce — and since `absent` is now re-checked once its answer goes
   * stale, leaving it null would make every test album look overdue.
   */
  async function albumWithStatus(
    payload: typeof singleArtistAlbum,
    status: Database['public']['Enums']['artwork_status'],
    checkedAt: Date = new Date(),
  ) {
    await ingestReleaseGroupPayload(payload, admin);
    await admin
      .from('albums')
      .update({ artwork_status: status, artwork_updated_at: checkedAt.toISOString() })
      .eq('mbid', payload.id);
  }

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('queues the legacy pending rows the seed left behind', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');

    const result = await enqueueMissingArtwork({ admin });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
    expect((await artworkJob())?.status).toBe('pending');
  });

  it('queues albums whose retries were exhausted', async () => {
    await albumWithStatus(singleArtistAlbum, 'failed');

    const result = await enqueueMissingArtwork({ admin });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('leaves settled albums alone', async () => {
    // **Amended 2026-09-16 rather than deleted.** This asserted that `absent`
    // was settled forever. It is now settled only until its answer goes stale,
    // because `product-spec.md` §8.9 invites people to upload a missing cover
    // and an album never looked at again would make that invisible. The
    // assertion the test was protecting — that a *recent* answer is not
    // re-asked — is unchanged and is what it now checks.
    await albumWithStatus(singleArtistAlbum, 'found');
    await albumWithStatus(yearOnlyAlbum, 'absent', daysAgo(1));

    const result = await enqueueMissingArtwork({ admin });

    // Re-fetching a cover we already have, or re-asking a question answered
    // yesterday, spends drain slots a first-time fetch needed.
    expect(result).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('re-checks an absent album once its answer is stale', async () => {
    // The case the cover-art prompt depends on: somebody uploads to Cover Art
    // Archive, and this is the only thing that ever notices.
    await albumWithStatus(yearOnlyAlbum, 'absent', daysAgo(ABSENT_RECHECK_DAYS + 1));

    const result = await enqueueMissingArtwork({ admin });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('still leaves an album that already has its cover, however old the answer', async () => {
    // `found` is the one status that is settled permanently. Staleness must not
    // leak into it — re-fetching artwork we hold buys nothing at any age.
    await albumWithStatus(singleArtistAlbum, 'found', daysAgo(ABSENT_RECHECK_DAYS * 10));

    const result = await enqueueMissingArtwork({ admin });

    expect(result).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('is idempotent — a second sweep queues nothing new', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');

    const first = await enqueueMissingArtwork({ admin });
    const second = await enqueueMissingArtwork({ admin });

    expect(first.queued).toBe(1);
    // The partial unique index makes the duplicate a no-op rather than an error.
    expect(second.queued).toBe(0);

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'fetch_artwork');
    expect(count).toBe(1);
  });

  it('respects the limit, so a daily drain is not buried', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');
    await albumWithStatus(yearOnlyAlbum, 'pending');

    const result = await enqueueMissingArtwork({ admin, limit: 1 });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('sweeps and then drains to completion', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockImplementation(async (mbid, client) => {
      await (client ?? admin)
        .from('albums')
        .update({ artwork_status: 'found' })
        .eq('mbid', mbid as string);
      return { status: 'found', sizes: [500] };
    });

    await enqueueMissingArtwork({ admin });
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('found');
    // Nothing left to do, which is what recovery finishing looks like.
    expect(await enqueueMissingArtwork({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });
});

describe('stale running recovery', () => {
  const STALE_MINUTES = 91;
  const FRESH_MINUTES = 5;

  /**
   * Creates a row that looks exactly like an abandoned claim.
   *
   * Inserted rather than updated on purpose: `ingestion_jobs_set_updated_at` is
   * a BEFORE UPDATE trigger, so any update rewrites `updated_at` to now() and a
   * claim age cannot be backdated that way. Insert is not covered by it.
   */
  async function strand(
    mbid: string,
    minutesAgo: number,
    attempts = 1,
    status: Database['public']['Enums']['job_status'] = 'running',
  ) {
    const { data, error } = await admin
      .from('ingestion_jobs')
      .insert({
        kind: 'ingest_release_group',
        target_mbid: mbid,
        status,
        attempts,
        updated_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    return data!.id;
  }

  async function row(id: number) {
    const { data } = await admin.from('ingestion_jobs').select('*').eq('id', id).single();
    return data!;
  }

  it('reclaims a genuinely stale running job', async () => {
    const id = await strand(MBID_A, STALE_MINUTES);

    expect(await reclaimStaleJobs(admin)).toBe(1);

    const job = await row(id);
    expect(job.status).toBe('pending');
    expect(job.last_error).toMatch(/Reclaimed/);
  });

  it('leaves a freshly claimed running job alone', async () => {
    const id = await strand(MBID_A, FRESH_MINUTES);

    expect(await reclaimStaleJobs(admin)).toBe(0);
    expect((await row(id)).status).toBe('running');
  });

  it('reclaims several stale jobs in one pass', async () => {
    await strand(MBID_A, STALE_MINUTES);
    await strand(MBID_B, STALE_MINUTES);

    expect(await reclaimStaleJobs(admin)).toBe(2);
  });

  it('cannot reclaim the same job twice under concurrent reclaimers', async () => {
    await strand(MBID_A, STALE_MINUTES);

    const [first, second] = await Promise.all([reclaimStaleJobs(admin), reclaimStaleJobs(admin)]);

    // The predicate is re-evaluated under the row lock, so the loser matches
    // nothing and the job is handed back exactly once.
    expect(first + second).toBe(1);
  });

  it('does not disturb a job another drain is legitimately claiming', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    stubIngestSuccess();

    // Reclaim touches only `running`; claiming touches only `pending`. Run
    // together they must not interfere.
    const [, summary] = await Promise.all([reclaimStaleJobs(admin), drainJobs(1, admin)]);

    expect(summary.succeeded).toBe(1);
    expect(summary.reclaimed).toBe(0);
  });

  it('preserves attempts across reclaim', async () => {
    const id = await strand(MBID_A, STALE_MINUTES, 2);

    await reclaimStaleJobs(admin);

    // A stranding is an execution start, which `attempts` already counted.
    expect((await row(id)).attempts).toBe(2);
  });

  it('drives a reclaimed job to terminal failure rather than looping forever', async () => {
    // Stranded at max_attempts: the next claim takes it past the ceiling, so a
    // failure there is terminal. Preserving attempts is what bounds this.
    const id = await strand(MBID_A, STALE_MINUTES, 3);
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('still broken'));

    await drainJobs(10, admin);

    const job = await row(id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBeGreaterThanOrEqual(job.max_attempts);
  });

  it('leaves genuinely stale pending, succeeded and failed jobs untouched', async () => {
    // Inserted at their final status, never updated afterwards. An update here
    // would fire `ingestion_jobs_set_updated_at` and make the row fresh, and
    // the test would then pass even if reclaim stopped filtering on `running`
    // — proving nothing. These three are old enough to be reclaimed and are
    // spared only because of their status.
    const pending = await strand(MBID_A, STALE_MINUTES, 1, 'pending');
    const succeeded = await strand(MBID_B, STALE_MINUTES, 1, 'succeeded');
    const failed = await strand('0b0e4f1e-1111-4000-8000-0000000000cc', STALE_MINUTES, 1, 'failed');

    for (const id of [pending, succeeded, failed]) {
      const age = Date.now() - new Date((await row(id)).updated_at).getTime();
      expect(age).toBeGreaterThan(90 * 60_000);
    }

    expect(await reclaimStaleJobs(admin)).toBe(0);
    expect((await row(pending)).status).toBe('pending');
    expect((await row(succeeded)).status).toBe('succeeded');
    expect((await row(failed)).status).toBe('failed');
  });
});

describe('late worker fencing', () => {
  /**
   * The race this exists for, driven through the real drain path.
   *
   * The stub stands in for a slow worker: while execution A is "working", the
   * row is handed back and re-claimed by execution B, exactly as a reclaim
   * followed by another drain would leave it. When `drainJobs` then settles A,
   * the fencing must discard it.
   */
  function takeOverDuring(outcome: 'succeed' | 'throw') {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockImplementation(async () => {
      await admin.from('ingestion_jobs').update({ status: 'pending' }).eq('target_mbid', MBID_A);

      // Execution B claims it and takes attempts = N + 1.
      await admin.rpc('claim_ingestion_jobs', { batch_size: 1 });
      await admin
        .from('ingestion_jobs')
        .update({ status: 'succeeded', last_error: null })
        .eq('target_mbid', MBID_A);

      if (outcome === 'throw') throw new Error('A was slow, and failed late');
      return { status: 'ingested', albumId: 'stub', mbid: MBID_A };
    });
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({ status: 'found', sizes: [500] });
  }

  async function state() {
    const { data } = await admin
      .from('ingestion_jobs')
      .select('status, attempts, last_error')
      .eq('target_mbid', MBID_A)
      .eq('kind', 'ingest_release_group')
      .single();
    return data!;
  }

  it('a late success cannot overwrite the newer execution', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    takeOverDuring('succeed');

    const summary = await drainJobs(1, admin);

    // A's success is discarded rather than counted.
    expect(summary.superseded).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect((await state()).attempts).toBe(2);
  });

  it('a late failure cannot resurrect a succeeded job', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    takeOverDuring('throw');

    const summary = await drainJobs(1, admin);

    // Unfenced, this returned the row to `pending` with a backoff and undid a
    // completed job — the worst outcome available here.
    expect(summary.superseded).toBe(1);
    expect(summary.failed).toBe(0);

    const after = await state();
    expect(after.status).toBe('succeeded');
    expect(after.last_error).toBeNull();
  });

  it('the ordinary non-racing path still settles normally', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    stubIngestSuccess();

    const summary = await drainJobs(1, admin);

    expect(summary.succeeded).toBe(1);
    expect(summary.superseded).toBe(0);
    expect(summary.reclaimed).toBe(0);
  });
});

/**
 * Priority bands, and the property that actually matters.
 *
 * `architecture.md` §7, *Queue fairness*. Bulk artwork sharing a band with
 * rate-limited metadata let one successful discography expansion enqueue
 * roughly eight artwork rows that outranked the next artist's discovery job on
 * `id` alone, so the queue diverged rather than drained.
 *
 * **Reading `priority` back proves almost nothing on its own** — it restates
 * the constant. The claim-ordering case below is the regression test: it goes
 * through the real `claim_ingestion_jobs` and fails if the band is removed.
 */
describe('the bulk artwork band', () => {
  async function priorityOf(mbid: string) {
    const { data } = await admin
      .from('ingestion_jobs')
      .select('priority')
      .eq('kind', 'fetch_artwork')
      .eq('target_mbid', mbid)
      .single();
    return data?.priority;
  }

  it('claims a later-queued discovery job ahead of earlier bulk artwork', async () => {
    // **The artwork jobs are queued through production code, not with the
    // constant passed in.** Asserting the ordering against an explicitly
    // prioritised row would pass even if every enqueue site reverted to the
    // background band — it would only be testing the claim function. Going
    // through the sweep means this fails if the default moves back.
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await ingestReleaseGroupPayload(yearOnlyAlbum, admin);
    await admin
      .from('albums')
      .update({ artwork_status: 'pending' })
      .in('mbid', [singleArtistAlbum.id, yearOnlyAlbum.id]);
    await enqueueMissingArtwork({ admin });

    // Queued last, so it holds the highest id and loses every tie on id alone.
    await enqueueJob('discover_curated_artist', MBID_B, { admin });

    const { data, error } = await admin.rpc('claim_ingestion_jobs', { batch_size: 1 });
    if (error) throw error;

    expect(data).toHaveLength(1);
    expect(data![0].kind).toBe('discover_curated_artist');
  });

  it('sweeps missing artwork into the bulk band by default', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await admin
      .from('albums')
      .update({ artwork_status: 'pending' })
      .eq('mbid', singleArtistAlbum.id);

    await enqueueMissingArtwork({ admin });

    expect(await priorityOf(singleArtistAlbum.id)).toBe(BULK_ARTWORK_PRIORITY);
  });

  it('still lets a caller override the sweep default', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await admin
      .from('albums')
      .update({ artwork_status: 'pending' })
      .eq('mbid', singleArtistAlbum.id);

    await enqueueMissingArtwork({ admin, priority: INTERACTIVE_JOB_PRIORITY });

    expect(await priorityOf(singleArtistAlbum.id)).toBe(INTERACTIVE_JOB_PRIORITY);
  });

  it('sends artwork from a background ingest to the bulk band', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    stubIngestSuccess();

    await drainJobs(1, admin);

    expect(await priorityOf(MBID_A)).toBe(BULK_ARTWORK_PRIORITY);
  });

  it('lets artwork inherit the urgency of an interactive ingest', async () => {
    // The album page enqueues `ingest_release_group` at this priority when a
    // reader opens an unhydrated album. Demoting its artwork would have made
    // that cover arrive later than before the band existed.
    await enqueueJob('ingest_release_group', MBID_A, {
      admin,
      priority: INTERACTIVE_JOB_PRIORITY,
    });
    stubIngestSuccess();

    await drainJobs(1, admin);

    expect(await priorityOf(MBID_A)).toBe(INTERACTIVE_JOB_PRIORITY);
  });
});

/**
 * Re-queueing expansions whose attempts were exhausted.
 *
 * `architecture.md` §7, *Recovery sweeps*. A terminally failed expansion reads as
 * `settled`, so the artist page shows no status line and nothing retries — an
 * artist was permanently capped by a transient MusicBrainz 503, which was ruled
 * a defect.
 *
 * **The two cases that carry the decision are the cooling-off boundary and the
 * `succeeded` exclusion.** The first is the bound that replaces an attempt cap;
 * the second is the single `where` value that keeps a staleness policy
 * undecided, and without a test it is one character from being answered by
 * accident.
 */
describe('enqueueFailedExpansions', () => {
  const A = '0b0e4f1e-1111-4000-8000-0000000000a1';
  const B = '0b0e4f1e-1111-4000-8000-0000000000a2';

  /**
   * **`updated_at` is set at insert, not by a later update, and that is forced.**
   * `ingestion_jobs_set_updated_at` fires `before update`, so writing an old
   * timestamp in a second statement is immediately overwritten with `now()` —
   * which silently made every cooling-off case look fresh. Insert-time values
   * survive because the trigger has no `before insert` counterpart.
   *
   * In production this column means what the sweep reads it as: `markFailed`
   * updates the row, the trigger stamps it, so a `failed` row's `updated_at` is
   * when it failed.
   */
  async function seed(
    mbid: string,
    status: Database['public']['Enums']['job_status'],
    agoMs: number,
  ) {
    const { error } = await admin.from('ingestion_jobs').insert({
      kind: 'discover_curated_artist',
      target_mbid: mbid,
      status,
      updated_at: new Date(Date.now() - agoMs).toISOString(),
    });
    if (error) throw error;
  }

  const DAY = 24 * 60 * 60 * 1000;

  async function jobsFor(mbid: string) {
    const { data } = await admin
      .from('ingestion_jobs')
      .select('status')
      .eq('kind', 'discover_curated_artist')
      .eq('target_mbid', mbid);
    return data ?? [];
  }

  it('re-queues a failure older than the cooling-off period', async () => {
    await seed(A, 'failed', DAY + 60 * 60 * 1000);

    expect(await enqueueFailedExpansions({ admin })).toMatchObject({ candidates: 1, queued: 1 });
    expect((await jobsFor(A)).map((j) => j.status).sort()).toEqual(['failed', 'pending']);
  });

  it('leaves a failure inside the cooling-off period alone', async () => {
    // 23 hours. The boundary is what makes this a bound rather than a gesture.
    await seed(A, 'failed', 23 * 60 * 60 * 1000);

    expect(await enqueueFailedExpansions({ admin })).toMatchObject({ candidates: 0, queued: 0 });
    expect(await jobsFor(A)).toHaveLength(1);
  });

  it('never touches an artist whose expansion succeeded', async () => {
    // The F-029 guard. Sweeping `succeeded` rows would be a staleness policy,
    // which `product-spec.md` §8.9 leaves explicitly undecided.
    await seed(A, 'succeeded', 30 * DAY);

    expect(await enqueueFailedExpansions({ admin })).toMatchObject({ candidates: 0, queued: 0 });
    expect(await jobsFor(A)).toHaveLength(1);
  });

  it('skips an artist that failed once but has since succeeded', async () => {
    await seed(A, 'failed', 10 * DAY);
    await seed(A, 'succeeded', 9 * DAY);

    expect(await enqueueFailedExpansions({ admin })).toMatchObject({ candidates: 0, queued: 0 });
    expect(await jobsFor(A)).toHaveLength(2);
  });

  it('skips an artist with work already outstanding', async () => {
    await seed(A, 'failed', 10 * DAY);
    await seed(A, 'pending', 0);

    expect(await enqueueFailedExpansions({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('sweeps several artists in one pass, and is idempotent', async () => {
    await seed(A, 'failed', 10 * DAY);
    await seed(B, 'failed', 10 * DAY);

    expect(await enqueueFailedExpansions({ admin })).toMatchObject({ candidates: 2, queued: 2 });
    // The second pass finds nothing: both now have a pending row.
    expect(await enqueueFailedExpansions({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('honours an explicit priority, and defaults to the background band', async () => {
    await seed(A, 'failed', 10 * DAY);
    await enqueueFailedExpansions({ admin });

    const { data } = await admin
      .from('ingestion_jobs')
      .select('priority')
      .eq('kind', 'discover_curated_artist')
      .eq('target_mbid', A)
      .eq('status', 'pending')
      .single();
    expect(data?.priority).toBe(DEFAULT_JOB_PRIORITY);
  });
});

/**
 * Alias enqueueing - F-019.
 *
 * **What is under test is termination, not matching.** Whether an alias widens
 * search is `search.test.ts`'s question; the question here is whether a sweep
 * ever stops, which is the thing `alias_status` was added to guarantee.
 */
describe('enqueueMissingArtistAliases', () => {
  const ARTIST_A = '0b0e4f1e-7777-4000-8000-00000000aaaa';
  const ARTIST_B = '0b0e4f1e-7777-4000-8000-00000000bbbb';

  async function seedArtist(mbid: string, aliasStatus: 'pending' | 'stored' | 'absent' | 'failed') {
    const { error } = await admin.from('artists').insert({
      mbid,
      name: `Artist ${mbid.slice(-4)}`,
      sort_name: 'x',
      alias_status: aliasStatus,
    });
    if (error) throw error;
  }

  it('queues an artist that has never been attempted', async () => {
    await seedArtist(ARTIST_A, 'pending');

    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 1,
      queued: 1,
    });
  });

  it('retries an artist whose fetch failed', async () => {
    await seedArtist(ARTIST_A, 'failed');

    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 1,
      queued: 1,
    });
  });

  it('never re-queues an artist MusicBrainz has no aliases for', async () => {
    // **The defect this column exists to prevent.** Judged by `artist_aliases`
    // alone this artist is identical to an unfetched one, so an anti-join there
    // would spend a request re-learning `absent` on every sweep, forever.
    await seedArtist(ARTIST_A, 'absent');

    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 0,
      queued: 0,
    });
  });

  it('never re-queues an artist whose aliases are stored', async () => {
    await seedArtist(ARTIST_A, 'stored');

    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 0,
      queued: 0,
    });
  });

  it('sweeps several artists in one pass, and is idempotent', async () => {
    await seedArtist(ARTIST_A, 'pending');
    await seedArtist(ARTIST_B, 'failed');

    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 2,
      queued: 2,
    });
    // Both now carry an outstanding job, so the second pass queues nothing
    // even though neither status has changed yet.
    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 2,
      queued: 0,
    });
  });

  it('honours the limit', async () => {
    await seedArtist(ARTIST_A, 'pending');
    await seedArtist(ARTIST_B, 'pending');

    expect(await enqueueMissingArtistAliases({ admin, limit: 1 })).toMatchObject({
      candidates: 1,
      queued: 1,
    });
  });

  it('defaults a new artist to pending, so ingestion makes it a candidate', async () => {
    // The column default is what connects this sweep to ordinary ingestion:
    // nothing has to remember to mark a newly ingested artist as owing aliases.
    const { error } = await admin
      .from('artists')
      .insert({ mbid: ARTIST_A, name: 'Fresh', sort_name: 'Fresh' });
    if (error) throw error;

    const { data } = await admin
      .from('artists')
      .select('alias_status')
      .eq('mbid', ARTIST_A)
      .single();
    expect(data?.alias_status).toBe('pending');
  });
});

/**
 * A 404 on the alias fetch is settled, not retryable - found at STEP G.
 *
 * **This was a real defect in the first implementation**, which recorded a 404
 * as `failed`. `failed` is retryable, so an artist MusicBrainz had merged away
 * would be re-queued on every sweep forever, spending the shared 1 req/sec
 * budget each time to re-learn the same permanent fact.
 */
describe('alias fetch treats a vanished artist as absence', () => {
  const GONE = '0b0e4f1e-7777-4000-8000-00000000dead';

  it('records absent, so the sweep never queues that artist again', async () => {
    const { error } = await admin
      .from('artists')
      .insert({ mbid: GONE, name: 'Merged Away', sort_name: 'Merged Away' });
    if (error) throw error;

    vi.spyOn(mb, 'getArtistWithAliases').mockRejectedValue(new mb.NotFoundError(GONE));

    const result = await fetchAndStoreArtistAliases(GONE, admin);
    expect(result.status).toBe('absent');

    const { data } = await admin.from('artists').select('alias_status').eq('mbid', GONE).single();
    expect(data?.alias_status).toBe('absent');

    // The sweep is the thing that would have looped.
    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 0,
      queued: 0,
    });
  });

  it('still records a transient error as failed, so it is retried', async () => {
    const { error } = await admin
      .from('artists')
      .insert({ mbid: GONE, name: 'Flaky', sort_name: 'Flaky' });
    if (error) throw error;

    // A 503 is the rate limiter being exceeded - exactly what must be retried.
    vi.spyOn(mb, 'getArtistWithAliases').mockRejectedValue(new Error('503 Service Unavailable'));

    expect((await fetchAndStoreArtistAliases(GONE, admin)).status).toBe('failed');

    const { data } = await admin.from('artists').select('alias_status').eq('mbid', GONE).single();
    expect(data?.alias_status).toBe('failed');

    expect(await enqueueMissingArtistAliases({ admin })).toMatchObject({
      candidates: 1,
      queued: 1,
    });
  });
});

/**
 * Refreshing a tracklist captured before the album came out - F-061,
 * `architecture.md` §7.4.
 *
 * **The question under test is which rows the predicate selects**, because the
 * obvious alternative selects none. `releases.track_count` was captured in the
 * same stale fetch, so "stored tracks fewer than declared" reads 3 against 3
 * for an album that now has sixteen upstream - a check that looks like it works
 * and finds nothing.
 */
describe('enqueueStaleTracklists', () => {
  const ALBUM = '0b0e4f1e-8888-4000-8000-00000000cccc';
  const RELEASE = '0b0e4f1e-8888-4000-8000-00000000dddd';

  async function seedAlbum(opts: {
    firstRelease: string | null;
    tracklistStatus: 'found' | 'pending' | 'failed';
    tracklistUpdatedAt: string;
  }) {
    const { data: album, error } = await admin
      .from('albums')
      .insert({
        mbid: ALBUM,
        title: 'Popstar',
        display_credit: 'Some Artist',
        primary_type: 'album',
        first_release_date: opts.firstRelease,
        first_release_date_precision: opts.firstRelease ? 'day' : null,
      })
      .select('id')
      .single();
    if (error) throw error;

    const { data: release, error: relError } = await admin
      .from('releases')
      .insert({
        mbid: RELEASE,
        album_id: album!.id,
        title: 'Popstar',
        tracklist_status: opts.tracklistStatus,
        tracklist_updated_at: opts.tracklistUpdatedAt,
        track_count: 3,
      })
      .select('id')
      .single();
    if (relError) throw relError;

    const { error: repError } = await admin
      .from('albums')
      .update({ representative_release_id: release!.id })
      .eq('id', album!.id);
    if (repError) throw repError;
  }

  it('queues a tracklist fetched before the album was released', async () => {
    // The real case: added in August, released 25 September.
    await seedAlbum({
      firstRelease: '2026-09-25',
      tracklistStatus: 'found',
      tracklistUpdatedAt: '2026-08-25T19:05:49Z',
    });

    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('leaves a tracklist fetched after release alone', async () => {
    // **The containment assertion.** If this queued, the sweep would be a
    // general staleness rule over every settled tracklist in the catalogue -
    // the open question §7.4 refuses to answer by accident.
    await seedAlbum({
      firstRelease: '2026-09-25',
      tracklistStatus: 'found',
      tracklistUpdatedAt: '2026-09-26T10:00:00Z',
    });

    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('is self-clearing: a refreshed tracklist stops matching', async () => {
    await seedAlbum({
      firstRelease: '2026-09-25',
      tracklistStatus: 'found',
      tracklistUpdatedAt: '2026-08-25T19:05:49Z',
    });
    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 1 });

    // What `recordTracklistStatus` does on every attempt.
    await admin
      .from('releases')
      .update({ tracklist_updated_at: new Date().toISOString() })
      .eq('mbid', RELEASE);

    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('ignores a tracklist that was never successfully fetched', async () => {
    // `pending` and `failed` belong to `enqueueMissingTracklists`. Queuing them
    // here would double-queue every unfetched release in the catalogue.
    await seedAlbum({
      firstRelease: '2026-09-25',
      tracklistStatus: 'pending',
      tracklistUpdatedAt: '2026-08-25T19:05:49Z',
    });

    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('ignores an album with no release date to compare against', async () => {
    await seedAlbum({
      firstRelease: null,
      tracklistStatus: 'found',
      tracklistUpdatedAt: '2026-08-25T19:05:49Z',
    });

    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('does not double-queue when a fetch is already outstanding', async () => {
    await seedAlbum({
      firstRelease: '2026-09-25',
      tracklistStatus: 'found',
      tracklistUpdatedAt: '2026-08-25T19:05:49Z',
    });
    await enqueueJob('fetch_tracklist', RELEASE, { admin });

    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 1, queued: 0 });
  });

  it('would find nothing by the declared track count, which is why that is not the test', async () => {
    // Documents the trap rather than the fix. `track_count` is 3 because it was
    // captured in the same stale fetch; upstream now says 16. Any detector
    // built on it reports a healthy catalogue.
    await seedAlbum({
      firstRelease: '2026-09-25',
      tracklistStatus: 'found',
      tracklistUpdatedAt: '2026-08-25T19:05:49Z',
    });

    const { data } = await admin
      .from('releases')
      .select('track_count')
      .eq('mbid', RELEASE)
      .single();
    const stored = 3; // what writeTracklist actually inserted at the time

    expect(data!.track_count).toBe(stored); // equal, so "stored < declared" is false
    expect(await enqueueStaleTracklists({ admin })).toMatchObject({ candidates: 1 });
  });
});

/**
 * The paging contract, added after the first implementation got it wrong.
 *
 * **It read 100 albums and filtered in JavaScript**, so whether a stale
 * tracklist was found depended on where its album fell in the page - the
 * defect its own comment claimed to avoid.
 */
describe('enqueueStaleTracklists pages rather than truncating', () => {
  it('reports a complete scan, so a caller can tell a clean sweep from a capped one', async () => {
    const result = await enqueueStaleTracklists({ admin });

    // `truncated` is the honest signal. A sweep that stopped at its page guard
    // must never be indistinguishable from one that found nothing.
    expect(result.truncated).toBe(false);
    expect(result.scanned).toBeGreaterThanOrEqual(0);
  });

  it('says so when the page guard stops it early', async () => {
    const { data: album, error } = await admin
      .from('albums')
      .insert({
        mbid: '0b0e4f1e-9999-4000-8000-00000000eeee',
        title: 'Anything',
        display_credit: 'Someone',
        primary_type: 'album',
        first_release_date: '2026-09-25',
        first_release_date_precision: 'day',
      })
      .select('id')
      .single();
    if (error) throw error;

    const { data: release, error: relError } = await admin
      .from('releases')
      .insert({
        mbid: '0b0e4f1e-9999-4000-8000-00000000ffff',
        album_id: album!.id,
        title: 'Anything',
        tracklist_status: 'found',
        tracklist_updated_at: '2026-08-01T00:00:00Z',
      })
      .select('id')
      .single();
    if (relError) throw relError;

    await admin
      .from('albums')
      .update({ representative_release_id: release!.id })
      .eq('id', album!.id);

    // maxPages 0 means it never reads a page at all, which must report
    // `truncated` rather than a confident zero.
    const result = await enqueueStaleTracklists({ admin, maxPages: 0 });
    expect(result.truncated).toBe(true);
    expect(result.candidates).toBe(0);
  });
});
