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

/**
 * Artwork nobody is waiting for.
 *
 * **A higher number than `DEFAULT_JOB_PRIORITY`, so it is claimed later — and
 * that is the whole point.** Cover Art Archive imposes no rate limit, so bulk
 * artwork is cheap to fetch and endless to queue: one successful discography
 * expansion creates roughly eight rows. Sharing the background band with
 * rate-limited metadata let those rows outrank the very work that produced
 * them, by `id` alone, so the queue diverged — success generated the backlog
 * that starved the next success.
 *
 * **This is not "artwork is background work".** Artwork a reader is waiting on
 * — a self-service add, or an album page being opened — keeps its urgency. See
 * `architecture.md` §7, *Queue fairness*.
 */
export const BULK_ARTWORK_PRIORITY = 200;

/**
 * Aliases nobody is waiting for.
 *
 * **Behind bulk artwork, which is already behind everything else.** An alias
 * changes nothing a reader can see until somebody searches a spelling the
 * catalogue does not hold, so it is the least urgent work in the queue — and
 * unlike artwork it **spends the MusicBrainz budget**, one request per artist
 * against a ceiling of one per second. A request taken for an alias is a
 * request not taken for an ingest somebody is waiting on.
 *
 * **Named rather than reusing `BULK_ARTWORK_PRIORITY`.** The two happen to
 * share a band today; a constant called *artwork* carrying alias jobs would be
 * a comment that lies, and the next person to retune artwork would move
 * aliases without meaning to.
 */
export const BULK_ALIAS_PRIORITY = 210;

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
