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
