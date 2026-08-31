import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Activity — the feed's materialised events.
 *
 * **This slice writes events and nothing reads them.** There is no feed query
 * and no feed surface; those are the next slice. The split is deliberate: the
 * anti-flood rule below is the one invariant in this phase whose failure cannot
 * be undone, so it is settled against a real database before any surface
 * depends on it — the same order Phase 2's first slice used.
 *
 * **The eligibility rule is the write path.** An interactive action writes an
 * event at the moment the user acts. A historical or backfilled write produces
 * none. `listened_on` does not decide it: an album added by hand is an
 * interaction whether the listen was last night or in 1997.
 *
 * **`addToCollection` is the interactive seam, and `ensureEntry` is not.** Both
 * create an entry through the same database function, and only the first
 * represents a user saying "add this album". Verified against every caller in
 * `src/` at the time of writing: `addToCollection` has exactly one — the album
 * page's add action — and the other `ensureEntry` callers are the implicit adds
 * behind rating, relistening and reviewing, each of which owns its own event or
 * deliberately none. **A future import calls `ensureEntry` and is silent by
 * construction rather than by remembering to be.**
 *
 * **Bulk interactive adds are not suppressed. [DECIDED 2026-08-31]** Two
 * hundred hand-added albums write two hundred events. `data-model.md` §11.9
 * raised suppressing, aggregating or rate-limiting them and left all three
 * open; grouping is now the feed's problem at read time. The write path stays
 * truthful because an event never written cannot be recovered, and deciding
 * presentation before a feed exists to look at would be deciding it blind. This
 * is also how the rest of the codebase reasons — averages computed on read,
 * events reading live values rather than snapshots.
 *
 * **Not written here, and each for its own reason:** likes, which would
 * dominate by volume; Want to Listen, whose removal behaviour is still `[OPEN]`;
 * list events, which belong to Phase 4 and whose table does not exist.
 */

export type Activity = Database['public']['Tables']['activity']['Row'];
type ActivityType = Database['public']['Enums']['activity_type'];

/**
 * Postgres unique-violation.
 *
 * Reached when an event already exists for this subject — a second `listened`
 * for one entry, or a second `reviewed` for one review. That is not a failure:
 * the event the caller wanted is already on record, so the write is dropped and
 * the action proceeds. It is the same treatment `addWantToListen` gives a
 * repeated add.
 */
const UNIQUE_VIOLATION = '23505';

/**
 * Writes one event, tolerating the case where it already exists.
 *
 * **Never throws on a duplicate, and never invents a subject.** The check
 * constraint pairs the type with the column that must carry it, so a caller
 * cannot record a `reviewed` event pointing at a relisten — the database
 * refuses rather than the feed defending against it later.
 */
async function record(
  actorId: string,
  type: ActivityType,
  subject: {
    collectionEntryId?: string;
    relistenEventId?: string;
    reviewId?: string;
  },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('activity').insert({
    actor_id: actorId,
    type,
    collection_entry_id: subject.collectionEntryId ?? null,
    relisten_event_id: subject.relistenEventId ?? null,
    review_id: subject.reviewId ?? null,
  });

  if (error && error.code !== UNIQUE_VIOLATION) throw error;
}

/**
 * A user added an album to their collection, interactively.
 *
 * **Called from `addToCollection` and nowhere else.** The implicit adds behind
 * rating, liking, relistening and reviewing must not reach this: rating an
 * album announces a rating, not a listen, and inferring the second from the
 * first is the surprise the eligibility rule exists to prevent.
 */
export function recordListened(actorId: string, collectionEntryId: string): Promise<void> {
  return record(actorId, 'listened', { collectionEntryId });
}

/**
 * A user rated an album.
 *
 * At most one per entry: re-rating edits what the existing event displays,
 * because the feed reads the entry's live value rather than a copy taken at
 * write time.
 */
export function recordRated(actorId: string, collectionEntryId: string): Promise<void> {
  return record(actorId, 'rated', { collectionEntryId });
}

/**
 * A user cleared their rating, so the event goes with it. **[DECIDED
 * 2026-08-31]**
 *
 * `data-model.md` §7 says undoing an action deletes its event, and the cascades
 * cover every case where a row disappears. Clearing a rating is the one case
 * where nothing disappears — the entry survives with a null rating — so it
 * needs an explicit delete. Left in place, the event would render a rating item
 * for an album that no longer carries one, which is precisely the claim that has
 * stopped being true that §7 exists to prevent.
 */
export async function removeRated(actorId: string, collectionEntryId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('activity')
    .delete()
    .eq('actor_id', actorId)
    .eq('type', 'rated')
    .eq('collection_entry_id', collectionEntryId);

  if (error) throw error;
}

/**
 * A user relistened to an album.
 *
 * One row per relisten, deliberately — three relistens are three feed items,
 * which is the whole reason `relisten_events` are discrete rows rather than a
 * counter.
 */
export function recordRelistened(actorId: string, relistenEventId: string): Promise<void> {
  return record(actorId, 'relistened', { relistenEventId });
}

/**
 * A user wrote or edited a review.
 *
 * One per review. Editing changes what the existing event shows; it does not
 * announce the review a second time.
 */
export function recordReviewed(actorId: string, reviewId: string): Promise<void> {
  return record(actorId, 'reviewed', { reviewId });
}
