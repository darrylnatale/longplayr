import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

import { countRows, COUNT_ONLY } from '../count';
import type { Database } from '@/lib/supabase/database.types';

import { CoverArtUnavailableError, fetchAndStoreArtwork } from './artwork';
import { discoverAndIngestArtist } from './curated-tranche';
import { ingestReleaseGroup } from './ingest';
import { BULK_ARTWORK_PRIORITY, DEFAULT_JOB_PRIORITY, enqueueJob } from './queue';
import { heldPayloadIds } from './payloads';
import { fetchAndStoreTracklist, TracklistUnavailableError } from './tracklist';

// Enqueueing lives in ./queue so that ingestion can queue a tracklist retry
// without importing this module, which already imports ingestion. Re-exported
// here because this is where callers expect to find it.
export { enqueueJob } from './queue';
export type { JobKind } from './queue';

import type { JobKind } from './queue';

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
 * **This is bounded by worker lifetime, not by job duration.** The right
 * question is not "how long can a job run" but "how long can a process hold a
 * claim at all", and every process that claims here is hard-bounded:
 *
 *   Vercel cron          60s     `maxDuration` on the drain route
 *   Search `after()`     60s     inherited from the search page route
 *   Album page `after()`   ?     the route states none; the platform default
 *   Seed runners       3600s     the vitest timeout on every runner that drains
 *
 * Past 60 minutes no such process is still alive, so a row still `running` is
 * abandoned by definition. 90 minutes is that ceiling plus half again, which
 * covers clock skew between the app and database clocks and any teardown lag.
 * The album route's unstated ceiling does not weaken that: whatever the
 * platform default is, it is nowhere near an hour.
 *
 * **The rationale was corrected on 2026-08-25; the value did not change.** This
 * used to argue that `updated_at` on a `running` row is the moment its *batch*
 * was claimed, so the tenth job in a batch looks stale before it starts. Per-job
 * claiming makes that false — `updated_at` is now approximately the moment that
 * job itself began. It also said only two workers claim, which was never true
 * of the two `after()` drains.
 *
 * **A duration-derived threshold is therefore now possible, and is still
 * declined.** Worker lifetime remains the safer variable, and the durations
 * themselves are still not retained: `updated_at` is overwritten when the job
 * terminates. A per-kind value is rejected for the same reason — it would be
 * tuned against duration and imply a precision no measurement supports.
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
  /**
   * Why the loop stopped.
   *
   * Reported because a short drain is otherwise indistinguishable from an empty
   * queue, and this cycle exists precisely because work that stops quietly is
   * the failure mode nobody notices.
   *
   * **A caller that supplies a budget must not loop on `claimed === 0`**: a
   * budget stop can claim nothing and still leave the queue full. Loop on
   * `stoppedBecause !== 'drained'` instead. The seed runners supply no budget,
   * so their existing `claimed === 0` check remains correct.
   */
  stoppedBecause: 'drained' | 'budget' | 'max_jobs';
};

/**
 * Rows a single claim asks for.
 *
 * One, deliberately: `drainJobs` claims immediately before executing, so an
 * interrupted drain strands at most one job (architecture.md §7). It is a named
 * constant because the drain both requests this number and refuses anything
 * larger — two places that must never drift apart.
 */
const CLAIM_BATCH_SIZE = 1;

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
    await enqueueJob('fetch_artwork', mbid, {
      admin,
      // Bulk by default. The only caller passes no priority and its default mode
      // queues without draining — up to 500 rows — so leaving this at the
      // background band would let the recovery tool recreate the starvation the
      // bulk band exists to prevent. An explicit priority still wins.
      priority: options.priority ?? BULK_ARTWORK_PRIORITY,
    });
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
      //
      // **The priority is inherited, not fixed.** This same case serves two
      // callers with opposite urgency: a bulk backfill, and the album page,
      // which enqueues `ingest_release_group` at INTERACTIVE_JOB_PRIORITY when
      // a reader opens an unhydrated album. Sending both to the bulk band would
      // make a just-opened album's cover arrive later than it used to. A parent
      // more urgent than background passes that urgency on; anything at or
      // below background yields bulk artwork.
      await enqueueJob('fetch_artwork', job.target_mbid, {
        admin,
        priority: job.priority < DEFAULT_JOB_PRIORITY ? job.priority : BULK_ARTWORK_PRIORITY,
      });
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
 * changes retry semantics least. The cost runs the other way: a job stranded
 * twice gets one real attempt before terminal failure, bounded because a
 * reclaimed row keeps its original `id` and claiming is ordered
 * `priority asc, id asc`, so it returns to the *front* of the queue. And
 * `RECLAIM_MARKER` lands in `last_error`, so a job exhausted this way says so
 * rather than looking like a silent failure.
 *
 * **[OPEN] — `attempts` can exceed `max_attempts` through repeated
 * interruption, and this comment used to claim otherwise.** It read that
 * preserving `attempts` "can never produce more than `max_attempts` starts".
 * Nothing enforces that. `max_attempts` is consulted in exactly one place —
 * `markFailed` — which runs only when a job throws inside a live process;
 * neither `claim_ingestion_jobs` nor this function consults it. A job claimed,
 * stranded and reclaimed repeatedly therefore has `attempts` incremented on
 * every claim, past `max_attempts`, with no terminal state ever reached —
 * neither retried to exhaustion nor surfaced as failed. **The behaviour is
 * deliberately unchanged**; see docs/architecture.md §7. Per-job claiming makes
 * it *rarer*, because an interruption now inflates one row rather than N, which
 * is a reduction in frequency and not a fix.
 *
 * A second statement went stale on the same date: stranding no longer "only
 * ever hits the *tail* of a batch", because per-job claiming leaves no batch
 * tail — it hits the one job in flight.
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
 * Returns rows to `pending` that were claimed but will not be run.
 *
 * **Fenced exactly as `markSucceeded` is, and for a stronger reason.** The
 * fence is `(id, status = 'running', attempts = <the value the claim
 * returned>)`, and that triple identifies one specific claim execution: a row
 * can only re-enter `running` through another claim, and claiming increments
 * `attempts`. So if another worker has advanced this row at all, the predicate
 * matches nothing and its work is left alone. A bare update on `id` could
 * revert a job someone else had legitimately taken.
 *
 * **Status, attempts and `run_after` are handled exactly as `reclaimStaleJobs`
 * handles them** — status moves to `pending`, the other two are untouched. A
 * reclaimed job may also never have executed, so "a claim spent an attempt
 * without an execution" is existing queue semantics rather than something this
 * path invents. Whether that is the right rule is a question for both paths at
 * once, not one to answer here.
 *
 * **Every row is attempted, and failures are returned rather than thrown.** A
 * loop that threw on the first failed release would abandon the rows after it —
 * leaving exactly the silently stranded `running` row this whole guard exists
 * to prevent, produced by the cleanup meant to prevent it. The caller reports
 * what could not be released.
 *
 * One statement per row: the fence is per-row, since each row carries its own
 * `attempts`.
 */
async function releaseClaims(
  jobs: Job[],
  admin: Admin,
): Promise<{ id: number; message: string }[]> {
  const unreleased: { id: number; message: string }[] = [];

  for (const job of jobs) {
    const { error } = await admin
      .from('ingestion_jobs')
      .update({ status: 'pending' })
      .eq('id', job.id)
      .eq('status', 'running')
      .eq('attempts', job.attempts);

    if (error) unreleased.push({ id: job.id, message: error.message });
  }

  return unreleased;
}

/**
 * Claims and runs jobs **one at a time**, up to `maxJobs`.
 *
 * **One claim per job, and that is the whole point.** This used to claim the
 * whole batch in a single `claim_ingestion_jobs` call and then work through it.
 * That marked every row `running` before any of them had run, so at millisecond
 * zero nothing distinguished the job being executed from the ones not yet
 * touched — and a worker killed mid-loop abandoned all of them. Measured on
 * staging: a 60-second cron claiming 10 jobs that average 9 seconds strands 4
 * a night (docs/architecture.md §7).
 *
 * **The invariant: at any instant, at most one row is `running` on behalf of
 * this worker.** An interruption can therefore abandon at most one row instead
 * of N. That is prevention of *multi-job* stranding, and it is structural. It
 * is **not** prevention of stranding: a job individually longer than its
 * worker's remaining life still strands, is still reclaimed, and still returns
 * to the head of the queue.
 *
 * `claim_ingestion_jobs` is untouched — it is simply called with a batch size
 * of one. `for update skip locked` gives the same divide-not-duplicate
 * guarantee at one row as at ten, so concurrent drains still split the work.
 *
 * **A job enqueued during a drain may be claimed later in the same
 * invocation.** `runJob` queues follow-up work — artwork after an ingest, a
 * tracklist retry, artwork per album created by curated discovery — and per-job
 * claiming can now reach it. That is an approved consequence of this design
 * rather than a separate decision: preventing it would need a high-water mark
 * inside the RPC. So `maxJobs` bounds the jobs this invocation actually
 * processes, not only those pending when it began.
 *
 * **Where a follow-up lands is no longer one answer. [2026-09-07]** This
 * previously read that a follow-up carries `DEFAULT_JOB_PRIORITY` and the
 * highest `id`, so ordering puts it behind the existing backlog. Since the
 * bulk artwork band that is wrong in both directions: artwork queued by bulk
 * work carries `BULK_ARTWORK_PRIORITY` and sorts behind even the backlog,
 * while artwork queued by interactive work inherits that urgency and is
 * claimed *ahead* of it. A tracklist retry still carries the background band.
 * On a near-empty queue any of them is claimed immediately.
 *
 * Jobs still run sequentially. The MusicBrainz rate limiter serialises requests
 * anyway, so concurrency here would buy nothing and only make failures harder
 * to attribute.
 *
 * @param maxJobs   Ceiling on jobs processed. A secondary cap, no longer the
 *                  safety mechanism — that is the claiming shape above.
 * @param options.budgetMs
 *                  Wall-clock budget, measured from entry. **Optional with no
 *                  default**, because no single value is right for both a
 *                  60-second function that has already spent 55 of them and a
 *                  3600-second seed runner. Checked *before* each claim and
 *                  never between claim and execution, so a claimed job always
 *                  runs — a job that crosses the budget finishes rather than
 *                  being abandoned. Only the cron route supplies one.
 */
export async function drainJobs(
  maxJobs = 10,
  admin: Admin = createAdminClient(),
  options: { budgetMs?: number } = {},
): Promise<DrainSummary> {
  const startedAt = Date.now();

  // Before claiming anything, return abandoned rows to the pool. A drain that
  // skipped this would claim around them forever: nothing else in the system
  // moves a row out of `running`. Once per invocation, not per job — reclaim is
  // a sweep, and running it in the loop would be the same UPDATE repeated.
  const reclaimed = await reclaimStaleJobs(admin);

  const summary: DrainSummary = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    exhausted: 0,
    reclaimed,
    superseded: 0,
    stoppedBecause: 'drained',
  };

  for (;;) {
    if (summary.claimed >= maxJobs) {
      summary.stoppedBecause = 'max_jobs';
      break;
    }

    // Checked here — before the claim — and nowhere else. Checking after the
    // claim would create exactly the row this cycle exists to stop creating:
    // one marked `running` that no worker will ever run.
    //
    // `!== undefined` rather than a truthy test, deliberately. `budgetMs: 0` is
    // a caller saying "I have no time left", and a truthy check would read that
    // as "no budget" and drain the queue instead.
    if (options.budgetMs !== undefined && Date.now() - startedAt >= options.budgetMs) {
      summary.stoppedBecause = 'budget';
      break;
    }

    const { data, error } = await admin.rpc('claim_ingestion_jobs', {
      batch_size: CLAIM_BATCH_SIZE,
    });
    if (error) throw error;

    // The claim asked for one row. If it hands back more, every extra row is
    // already `running` with its attempt spent, and taking only the first is
    // how they become invisible: no retry path sees them, no failure metric
    // counts them, and nothing recovers them until the 90-minute stale reclaim.
    // That is exactly the defect this guard exists because of — see
    // `20260831120000_enforce_claim_batch_size.sql`.
    //
    // **All of them are released, not just the surplus.** This throws without
    // running anything, so the first row is no more settled than the rest, and
    // leaving it `running` would strand a job just as silently.
    //
    // **Then it throws**, because a database function violating its own
    // cardinality is not an outcome the interface renders — it is the
    // unexpected failure CLAUDE.md keeps exceptions for. Processing the extras
    // instead would breach `maxJobs`, which the cron's 60-second ceiling
    // depends on.
    if (data && data.length > CLAIM_BATCH_SIZE) {
      const unreleased = await releaseClaims(data, admin);
      throw new Error(
        `claim_ingestion_jobs returned ${data.length} rows for batch_size ${CLAIM_BATCH_SIZE}; ` +
          (unreleased.length === 0
            ? `released ${data.map((row) => row.id).join(', ')} back to pending`
            : `could not release ${unreleased
                .map((row) => `${row.id} (${row.message})`)
                .join('; ')}`),
      );
    }

    const job = data?.[0];
    if (!job) {
      summary.stoppedBecause = 'drained';
      break;
    }

    summary.claimed += 1;

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
/**
 * Whether a job of one kind has ever been queued for one target, and where it
 * got to.
 *
 * **Three states, because two would lose the distinction that matters.**
 * `none` means no row has ever existed; `outstanding` means one is `pending` or
 * `running`; `settled` means every row for this target has finished, whether it
 * succeeded or failed terminally.
 *
 * **Failed counts as settled deliberately.** The queue owns retry — three
 * attempts behind 30s, 5min and 30min — so a row that reached `failed` has
 * already exhausted it. Treating that as "never attempted" would restart the
 * whole policy from a page view.
 *
 * **This reads history, not the queue.** Nothing purges `ingestion_jobs`, so a
 * completed row is a durable record of an attempt. The partial unique index
 * covers only `pending` and `running` and deliberately lets completed work be
 * requeued later, so it cannot answer this question and is not asked to.
 */
export type AttemptState = 'none' | 'outstanding' | 'settled';

export async function attemptStateFor(
  kind: JobKind,
  targetMbid: string,
  admin: Admin = createAdminClient(),
): Promise<AttemptState> {
  const { data, error } = await admin
    .from('ingestion_jobs')
    .select('status')
    .eq('kind', kind)
    .eq('target_mbid', targetMbid);

  if (error) throw error;
  if (!data || data.length === 0) return 'none';

  const outstanding = data.some((row) => row.status === 'pending' || row.status === 'running');
  return outstanding ? 'outstanding' : 'settled';
}

export async function queueDepth(admin: Admin = createAdminClient()) {
  const statuses = ['pending', 'running', 'succeeded', 'failed'] as const;

  const counts = await Promise.all(
    statuses.map(async (status) => {
      const count = await countRows(
        admin.from('ingestion_jobs').select('id', COUNT_ONLY).eq('status', status),
        'ingestion_jobs.by_status',
      );
      return [status, count] as const;
    }),
  );

  return Object.fromEntries(counts) as Record<(typeof statuses)[number], number>;
}
