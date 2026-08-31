import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { singleArtistAlbum, yearOnlyAlbum } from '@/services/catalogue/fixtures';
import {
  drainJobs,
  enqueueJob,
  enqueueMissingArtwork,
  queueDepth,
  reclaimStaleJobs,
} from '@/services/catalogue/jobs';
import * as ingest from '@/services/catalogue/ingest';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import * as artwork from '@/services/catalogue/artwork';
import { ARTWORK_BUCKET } from '@/services/catalogue/artwork';
import { sleep } from '@/services/catalogue/rate-limiter';

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
  async function albumWithStatus(
    payload: typeof singleArtistAlbum,
    status: Database['public']['Enums']['artwork_status'],
  ) {
    await ingestReleaseGroupPayload(payload, admin);
    await admin.from('albums').update({ artwork_status: status }).eq('mbid', payload.id);
  }

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
    await albumWithStatus(singleArtistAlbum, 'found');
    await albumWithStatus(yearOnlyAlbum, 'absent');

    const result = await enqueueMissingArtwork({ admin });

    // Re-fetching a cover we already have, or re-asking a question already
    // answered, spends requests for nothing.
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
