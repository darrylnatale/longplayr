import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Enqueueing, on its own.
 *
 * Split out from `jobs.ts` for one structural reason: ingestion needs to queue
 * a tracklist retry, and `jobs.ts` already imports ingestion to run it. Putting
 * the enqueue here keeps the dependency one-directional instead of relying on
 * a module cycle resolving in the right order.
 *
 * `jobs.ts` re-exports `enqueueJob`, so existing callers are unaffected.
 */

type Admin = SupabaseClient<Database>;

export type JobKind = Database['public']['Enums']['job_kind'];

/**
 * Queues a job, ignoring duplicates.
 *
 * A partial unique index allows only one outstanding job per kind and target,
 * so enqueueing the same work twice is a no-op rather than an error — which is
 * what lets callers enqueue freely without checking first.
 */
/**
 * Background work: seeding, backfills, sweeps. Nobody is waiting for it.
 *
 * Jobs are claimed `order by priority asc, id asc`, so a lower number is
 * claimed sooner.
 */
export const DEFAULT_JOB_PRIORITY = 100;

/**
 * Work a person is waiting on, right now.
 *
 * A self-service catalogue addition is the case this exists for: someone went
 * and found a record we did not hold, and the cover is the difference between
 * a page that looks finished and one that looks broken. Queued behind a
 * thousand-album backfill it would be neither.
 */
export const INTERACTIVE_JOB_PRIORITY = 10;

export async function enqueueJob(
  kind: JobKind,
  targetMbid: string,
  options: { priority?: number; admin?: Admin } = {},
): Promise<void> {
  const admin = options.admin ?? createAdminClient();

  const { error } = await admin
    .from('ingestion_jobs')
    .insert({ kind, target_mbid: targetMbid, priority: options.priority ?? DEFAULT_JOB_PRIORITY });

  // 23505 is the partial unique index doing its job.
  if (error && error.code !== '23505') throw error;
}
