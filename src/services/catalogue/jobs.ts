import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

import { fetchAndStoreArtwork } from './artwork';
import { ingestReleaseGroup } from './ingest';

type Admin = SupabaseClient<Database>;
type Job = Database['public']['Tables']['ingestion_jobs']['Row'];
export type JobKind = Database['public']['Enums']['job_kind'];

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

export type DrainSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  exhausted: number;
};

/**
 * Queues a job, ignoring duplicates.
 *
 * A partial unique index allows only one outstanding job per kind and target,
 * so enqueueing the same work twice is a no-op rather than an error — which is
 * what lets callers enqueue freely without checking first.
 */
export async function enqueueJob(
  kind: JobKind,
  targetMbid: string,
  options: { priority?: number; admin?: Admin } = {},
): Promise<void> {
  const admin = options.admin ?? createAdminClient();

  const { error } = await admin
    .from('ingestion_jobs')
    .insert({ kind, target_mbid: targetMbid, priority: options.priority ?? 100 });

  // 23505 is the partial unique index doing its job.
  if (error && error.code !== '23505') throw error;
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
    case 'fetch_artwork':
      await fetchAndStoreArtwork(job.target_mbid, admin);
      return;
    case 'fetch_releases':
      // Editions are fetched lazily when someone opens the editions UI, which
      // does not exist yet. Queued work of this kind is a no-op for now.
      return;
  }
}

async function markSucceeded(job: Job, admin: Admin) {
  await admin
    .from('ingestion_jobs')
    .update({ status: 'succeeded', last_error: null })
    .eq('id', job.id);
}

async function markFailed(job: Job, admin: Admin, error: unknown): Promise<'retry' | 'exhausted'> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.max_attempts;

  if (exhausted) {
    await admin
      .from('ingestion_jobs')
      .update({ status: 'failed', last_error: message })
      .eq('id', job.id);
    return 'exhausted';
  }

  // Back to pending with a delay. attempts was already incremented at claim
  // time, so index 0 of the backoff table corresponds to the first failure.
  //
  // run_after is computed from the app clock but compared against the database
  // clock. Skew between them is milliseconds and the shortest backoff is 30
  // seconds, so it does not matter here — but anything that needs a delay near
  // zero should use the database clock instead.
  const delay = BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];

  await admin
    .from('ingestion_jobs')
    .update({
      status: 'pending',
      last_error: message,
      run_after: new Date(Date.now() + delay * 1000).toISOString(),
    })
    .eq('id', job.id);

  return 'retry';
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
  const { data: jobs, error } = await admin.rpc('claim_ingestion_jobs', {
    batch_size: batchSize,
  });
  if (error) throw error;

  const summary: DrainSummary = {
    claimed: jobs?.length ?? 0,
    succeeded: 0,
    failed: 0,
    exhausted: 0,
  };

  for (const job of jobs ?? []) {
    try {
      await runJob(job, admin);
      await markSucceeded(job, admin);
      summary.succeeded += 1;
    } catch (error) {
      const outcome = await markFailed(job, admin, error);
      if (outcome === 'exhausted') summary.exhausted += 1;
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
