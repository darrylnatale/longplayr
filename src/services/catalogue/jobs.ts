import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

import { CoverArtUnavailableError, fetchAndStoreArtwork } from './artwork';
import { discoverAndIngestArtist } from './curated-tranche';
import { ingestReleaseGroup } from './ingest';
import { enqueueJob } from './queue';
import { heldPayloadIds } from './payloads';
import { fetchAndStoreTracklist, TracklistUnavailableError } from './tracklist';

// Enqueueing lives in ./queue so that ingestion can queue a tracklist retry
// without importing this module, which already imports ingestion. Re-exported
// here because this is where callers expect to find it.
export { enqueueJob } from './queue';
export type { JobKind } from './queue';

type Admin = SupabaseClient<Database>;
type Job = Database['public']['Tables']['ingestion_jobs']['Row'];

/**
 * Bulk ingestion queue.
 *
 * Only bulk work goes through here. When a user adds a specific album it is
 * fetched inline, because making someone wait behind a seeding backlog for the
 * one record they asked for would be the wrong trade (docs/architecture.md §7).
 *
 * Claiming is atomic in the database (`claim_ingestion_jobs`), so overlapping
 * cron runs divide work rather than duplicating it — duplicated work here means
 * wasted requests against a one-per-second budget.
 */

/** Backoff between attempts. Deliberately well beyond the 1s rate window. */
const BACKOFF_SECONDS = [30, 300, 1800];

/**
 * How long a `running` row may sit before it is treated as abandoned.
 *
 * **This is bounded by worker lifetime, not by job duration**, and the
 * distinction is the whole reason a single global value is safe.
 * `updated_at` on a `running` row is the moment its *batch* was claimed, not
 * the moment that job began: the tenth job in a batch already has a stale-
 * looking timestamp before it starts. So "how long can a job run" is the wrong
 * question. The right one is how long a process can hold a claim at all.
 *
 * Two workers claim jobs, and both are hard-bounded in this repository:
 *
 *   Vercel cron     60s     `maxDuration` on the drain route
 *   Seed runners  3600s     the vitest timeout on every runner that drains
 *
 * Past 60 minutes no such process is still alive, so a row still `running` is
 * abandoned by definition. 90 minutes is that ceiling plus half again, which
 * covers clock skew between the app and database clocks and any teardown lag.
 *
 * **Deliberately not per-kind.** A per-kind value would be tuned against job
 * duration — the wrong variable — and would imply a precision no measurement
 * supports: nothing retains per-job durations, because `updated_at` is
 * overwritten when the job terminates.
 */
const STALE_AFTER_MINUTES = 90;

/** Written to `last_error` on reclaim, so an exhausted job stays diagnosable. */
const RECLAIM_MARKER = `Reclaimed after sitting in running for over ${STALE_AFTER_MINUTES} minutes.`;

export type DrainSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  exhausted: number;
  /** Stale rows returned to pending before this drain claimed anything. */
  reclaimed: number;
  /**
   * Completions discarded because the row had moved on — a worker finishing
   * after its claim was reclaimed and re-claimed by someone else.
   */
  superseded: number;
};

/** Artwork states that warrant another attempt. `found` and `absent` are settled. */
const ARTWORK_RETRYABLE: Database['public']['Enums']['artwork_status'][] = ['pending', 'failed'];

/**
 * Queues artwork for every album that still needs it.
 *
 * Two populations need this and neither is reached by the normal path:
 *
 *  - **Legacy `pending` rows.** The first seed predates the four-state model.
 *    Its Cover Art Archive failures threw before any status was written, so 36
 *    albums sit at `pending` — indistinguishable from never attempted — with no
 *    job queued and nothing scheduled to notice.
 *  - **Exhausted `failed` rows.** A job that burns all its attempts stops
 *    retrying by design. Reviving it is a deliberate act, which is this.
 *
 * Idempotent twice over: the partial unique index means an album with an
 * outstanding job is skipped, and re-running after a successful drain finds
 * nothing because those albums are no longer in a retryable state.
 *
 * Bounded on purpose. The queue drains once a day on Vercel's Hobby plan, so
 * enqueueing tens of thousands would build a backlog that outlives its useful
 * life rather than getting through it.
 */
export async function enqueueMissingArtwork(
  options: { limit?: number; priority?: number; admin?: Admin } = {},
): Promise<{ candidates: number; queued: number }> {
  const admin = options.admin ?? createAdminClient();
  const limit = options.limit ?? 500;

  const { data: albums, error } = await admin
    .from('albums')
    .select('mbid')
    .in('artwork_status', ARTWORK_RETRYABLE)
    .order('popularity_score', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  const mbids = (albums ?? []).map((album) => album.mbid);
  if (mbids.length === 0) return { candidates: 0, queued: 0 };

  // Which of these already have work outstanding, in one query rather than one
  // per album. The insert below is safe either way — the partial unique index
  // rejects a duplicate — but without this the count could not tell "queued now"
  // from "was already queued", which is the number that says whether a sweep
  // did anything.
  const { data: existing, error: jobsError } = await admin
    .from('ingestion_jobs')
    .select('target_mbid')
    .eq('kind', 'fetch_artwork')
    .in('status', ['pending', 'running'])
    .in('target_mbid', mbids);

  if (jobsError) throw jobsError;
  const outstanding = new Set((existing ?? []).map((job) => job.target_mbid));

  let queued = 0;
  for (const mbid of mbids) {
    if (outstanding.has(mbid)) continue;
    await enqueueJob('fetch_artwork', mbid, { admin, priority: options.priority });
    queued += 1;
  }

  return { candidates: mbids.length, queued };
}

/** Tracklist states that warrant another attempt. `found` and `absent` are settled. */
const TRACKLIST_RETRYABLE: Database['public']['Enums']['tracklist_status'][] = [
  'pending',
  'failed',
];

/**
 * Queues tracklists for every album whose representative release still needs one.
 *
 * **Representative releases only**, and that restriction is the whole design of
 * this query. Only the representative release ever gets a tracklist; the other
 * ~6,000 release rows are `pending` permanently and correctly. Sweeping by
 * status alone would queue 6,072 jobs where 44 are wanted, and spend a
 * one-request-per-second budget for weeks fetching editions no page displays.
 *
 * Idempotent on the same two axes as the artwork sweep: the partial unique
 * index skips releases with outstanding work, and a re-run after a successful
 * drain finds nothing because those releases are no longer retryable.
 */
/**
 * Queues a re-ingest for every album we hold no upstream payload for.
 *
 * **The backfill for `upstream_payloads`.** Payload capture was added after the
 * catalogue existed, so the albums ingested before it have columns but no
 * stored response. Re-running `ingest_release_group` is the whole fix: it
 * re-fetches the release group and the representative release, upserts on MBID
 * — so nothing is duplicated and `albums.id` never moves, leaving every
 * collection entry, rating and review untouched — and now stores both payloads
 * on the way through.
 *
 * **No new job kind.** `ingest_release_group` already does exactly this work;
 * inventing a `backfill_payload` kind would duplicate the runner for no
 * behaviour that differs.
 *
 * **Cost is the rate limit, not the code.** Two MusicBrainz requests per album,
 * serialised at one per second — roughly six minutes per three hundred albums.
 * That is a seed-style utility run against staging rather than something the
 * daily cron can chew through: the drain route is capped at `maxDuration = 60`,
 * and Vercel's Hobby plan runs it once a day.
 */
export async function enqueueMissingPayloads(
  options: { limit?: number; priority?: number; admin?: Admin } = {},
): Promise<{ candidates: number; queued: number }> {
  const admin = options.admin ?? createAdminClient();
  const limit = options.limit ?? 500;

  const { data: albums, error } = await admin
    .from('albums')
    .select('mbid')
    .order('popularity_score', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  const mbids = (albums ?? []).map((album) => album.mbid);
  if (mbids.length === 0) return { candidates: 0, queued: 0 };

  // Two set lookups rather than two queries per album: which already have a
  // payload, and which already have work outstanding. The second matters
  // because a sweep run twice should report that it queued nothing the second
  // time, not re-report the same backlog.
  const held = await heldPayloadIds(admin, 'release_group', mbids);

  const { data: existing, error: jobsError } = await admin
    .from('ingestion_jobs')
    .select('target_mbid')
    .eq('kind', 'ingest_release_group')
    .in('status', ['pending', 'running'])
    .in('target_mbid', mbids);

  if (jobsError) throw jobsError;
  const outstanding = new Set((existing ?? []).map((job) => job.target_mbid));

  const candidates = mbids.filter((mbid) => !held.has(mbid));

  let queued = 0;
  for (const mbid of candidates) {
    if (outstanding.has(mbid)) continue;
    await enqueueJob('ingest_release_group', mbid, { admin, priority: options.priority });
    queued += 1;
  }

  return { candidates: candidates.length, queued };
}

export async function enqueueMissingTracklists(
  options: { limit?: number; priority?: number; admin?: Admin } = {},
): Promise<{ candidates: number; queued: number }> {
  const admin = options.admin ?? createAdminClient();
  const limit = options.limit ?? 500;

  const { data: albums, error } = await admin
    .from('albums')
    .select('releases!albums_representative_release_fk(mbid, tracklist_status)')
    .not('representative_release_id', 'is', null)
    .order('popularity_score', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  const mbids = (albums ?? [])
    .map((row) => row.releases as { mbid: string; tracklist_status: string } | null)
    .filter(
      (release): release is { mbid: string; tracklist_status: string } =>
        release !== null && (TRACKLIST_RETRYABLE as string[]).includes(release.tracklist_status),
    )
    .map((release) => release.mbid);

  if (mbids.length === 0) return { candidates: 0, queued: 0 };

  const { data: existing, error: jobsError } = await admin
    .from('ingestion_jobs')
    .select('target_mbid')
    .eq('kind', 'fetch_tracklist')
    .in('status', ['pending', 'running'])
    .in('target_mbid', mbids);

  if (jobsError) throw jobsError;
  const outstanding = new Set((existing ?? []).map((job) => job.target_mbid));

  let queued = 0;
  for (const mbid of mbids) {
    if (outstanding.has(mbid)) continue;
    await enqueueJob('fetch_tracklist', mbid, { admin, priority: options.priority });
    queued += 1;
  }

  return { candidates: mbids.length, queued };
}

async function runJob(job: Job, admin: Admin): Promise<void> {
  switch (job.kind) {
    case 'ingest_release_group': {
      const result = await ingestReleaseGroup(job.target_mbid, admin);
      // An out-of-scope release group is a successful outcome, not a failure:
      // refusing a single is the system working as specified.
      if (result.status === 'out_of_scope') return;
      // Artwork is a separate job so a Cover Art Archive problem never fails
      // the metadata ingest that succeeded.
      await enqueueJob('fetch_artwork', job.target_mbid, { admin });
      return;
    }
    case 'fetch_artwork': {
      const result = await fetchAndStoreArtwork(job.target_mbid, admin);

      // fetchAndStoreArtwork records its outcome and returns rather than
      // throwing, so that a Cover Art Archive problem never fails a metadata
      // ingest that succeeded. Correct there, wrong here: returning normally
      // marked the job 'succeeded' even when the fetch had failed, so the album
      // was left at artwork_status 'failed' with nothing queued to try again.
      //
      // Re-raising hands the failure to the queue's existing retry, backoff and
      // exhaustion machinery. 'absent' is not a failure — Cover Art Archive
      // answered, and the answer was no cover.
      if (result.status === 'failed') {
        throw new CoverArtUnavailableError(result.reason);
      }
      return;
    }
    case 'fetch_tracklist': {
      const result = await fetchAndStoreTracklist(job.target_mbid, admin);

      // Same shape as artwork, and for the same reason. 'absent' means
      // MusicBrainz answered and the release carries no tracks, which is a
      // settled fact. 'failed' means we never got an answer, and the job must
      // go back into the queue rather than report success.
      if (result.status === 'failed') {
        throw new TracklistUnavailableError(result.reason);
      }
      return;
    }
    case 'discover_curated_artist': {
      // Browses one curated artist and creates whatever the tranche is missing.
      //
      // Throwing is the point: the request layer has already spent five
      // attempts under BACKGROUND_RETRY, so a failure here means the *artist*
      // needs a later attempt, and that is exactly what markFailed provides —
      // back to pending behind 30s/5min/30min, then terminally failed and
      // visible. Nothing about this artist is written on failure.
      await discoverAndIngestArtist(job.target_mbid, admin);
      return;
    }
    case 'fetch_releases':
      // Editions are fetched lazily when someone opens the editions UI, which
      // does not exist yet. Queued work of this kind is a no-op for now.
      return;
  }
}

/**
 * Returns abandoned `running` rows to `pending`.
 *
 * **One statement, and that is what makes it safe.** Postgres evaluates the
 * predicate under the row lock, so a second reclaimer running concurrently
 * blocks, re-reads, finds `status = 'pending'` and updates nothing. No
 * `skip locked`, no advisory lock and no RPC is needed for that guarantee.
 *
 * It also cannot race `claim_ingestion_jobs`: that touches only `pending` rows
 * and this touches only `running` ones, so their predicates are disjoint.
 *
 * **`attempts` is left exactly as it is.** It counts *execution starts* — it is
 * incremented at claim, and `markFailed` compares it against `max_attempts` —
 * and a stranded job did start. Preserving it is therefore the reading that
 * changes retry semantics least, and it can never produce more than
 * `max_attempts` starts. The cost runs the other way: a job stranded twice gets
 * one real attempt before terminal failure. Two things bound that. A reclaimed
 * row keeps its original `id`, and claiming is ordered `priority asc, id asc`,
 * so it returns to the *front* of the queue — while stranding only ever hits
 * the *tail* of a batch. And `RECLAIM_MARKER` lands in `last_error`, so a job
 * exhausted this way says so rather than looking like a silent failure.
 *
 * **`run_after` is deliberately left alone.** The row was claimed, which
 * required `run_after <= now()`, so it is already in the past and the job is
 * immediately eligible again. Writing `now()` here would be worse, not
 * neutral: `run_after` is computed from the app clock and compared against the
 * database clock, and `markFailed` already records that anything needing a
 * delay near zero must not do that. Milliseconds of skew were enough to make a
 * reclaimed job invisible to the very next claim.
 *
 * **This makes stranding recoverable; it does not prevent it.** The 60-second
 * ceiling on the cron is untouched, so a killed invocation still abandons the
 * rest of its batch — the next drain picks them up.
 */
export async function reclaimStaleJobs(admin: Admin = createAdminClient()): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('ingestion_jobs')
    .update({ status: 'pending', last_error: RECLAIM_MARKER })
    .eq('status', 'running')
    .lt('updated_at', cutoff)
    .select('id');

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Settling a job is fenced: it lands only if the row is still the execution
 * that claimed it.
 *
 * `attempts` is the fencing token. `claim_ingestion_jobs` increments it and
 * returns the incremented row, so the in-memory `job` identifies one specific
 * execution. If that claim was reclaimed and taken by someone else, the row now
 * holds a higher `attempts` and the update matches nothing.
 *
 * Both conditions are load-bearing. `status = 'running'` catches a row that was
 * reclaimed but not yet re-claimed; `attempts` catches one that has been. These
 * used to be bare updates on `id`, which let a slow worker overwrite a newer
 * execution — and in the `markFailed` case return an already `succeeded` job to
 * `pending` with a backoff, resurrecting finished work.
 */
async function markSucceeded(job: Job, admin: Admin): Promise<'settled' | 'superseded'> {
  const { data, error } = await admin
    .from('ingestion_jobs')
    .update({ status: 'succeeded', last_error: null })
    .eq('id', job.id)
    .eq('status', 'running')
    .eq('attempts', job.attempts)
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0 ? 'settled' : 'superseded';
}

async function markFailed(
  job: Job,
  admin: Admin,
  error: unknown,
): Promise<'retry' | 'exhausted' | 'superseded'> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.max_attempts;

  if (exhausted) {
    const { data, error: updateError } = await admin
      .from('ingestion_jobs')
      .update({ status: 'failed', last_error: message })
      .eq('id', job.id)
      .eq('status', 'running')
      .eq('attempts', job.attempts)
      .select('id');
    if (updateError) throw updateError;
    return (data?.length ?? 0) > 0 ? 'exhausted' : 'superseded';
  }

  // Back to pending with a delay. attempts was already incremented at claim
  // time, so index 0 of the backoff table corresponds to the first failure.
  //
  // run_after is computed from the app clock but compared against the database
  // clock. Skew between them is milliseconds and the shortest backoff is 30
  // seconds, so it does not matter here — but anything that needs a delay near
  // zero should use the database clock instead.
  const delay = BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];

  const { data, error: updateError } = await admin
    .from('ingestion_jobs')
    .update({
      status: 'pending',
      last_error: message,
      run_after: new Date(Date.now() + delay * 1000).toISOString(),
    })
    .eq('id', job.id)
    .eq('status', 'running')
    .eq('attempts', job.attempts)
    .select('id');

  if (updateError) throw updateError;
  return (data?.length ?? 0) > 0 ? 'retry' : 'superseded';
}

/**
 * Claims and runs up to `batchSize` jobs.
 *
 * Jobs run sequentially. The MusicBrainz rate limiter serialises requests
 * anyway, so concurrency here would buy nothing and only make failures harder
 * to attribute.
 */
export async function drainJobs(
  batchSize = 10,
  admin: Admin = createAdminClient(),
): Promise<DrainSummary> {
  // Before claiming anything, return abandoned rows to the pool. A drain that
  // skipped this would claim around them forever: nothing else in the system
  // moves a row out of `running`.
  const reclaimed = await reclaimStaleJobs(admin);

  const { data: jobs, error } = await admin.rpc('claim_ingestion_jobs', {
    batch_size: batchSize,
  });
  if (error) throw error;

  const summary: DrainSummary = {
    claimed: jobs?.length ?? 0,
    succeeded: 0,
    failed: 0,
    exhausted: 0,
    reclaimed,
    superseded: 0,
  };

  for (const job of jobs ?? []) {
    try {
      await runJob(job, admin);
      const outcome = await markSucceeded(job, admin);
      if (outcome === 'superseded') summary.superseded += 1;
      else summary.succeeded += 1;
    } catch (error) {
      const outcome = await markFailed(job, admin, error);
      if (outcome === 'exhausted') summary.exhausted += 1;
      else if (outcome === 'superseded') summary.superseded += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

/** Queue depth by status, for monitoring. */
export async function queueDepth(admin: Admin = createAdminClient()) {
  const statuses = ['pending', 'running', 'succeeded', 'failed'] as const;

  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await admin
        .from('ingestion_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw error;
      return [status, count ?? 0] as const;
    }),
  );

  return Object.fromEntries(counts) as Record<(typeof statuses)[number], number>;
}
