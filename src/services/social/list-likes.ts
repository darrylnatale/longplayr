import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { countRows, COUNT_ONLY } from '../count';
import { getCurrentProfile } from '../profiles';
import { recordListLiked } from './notifications';
import { err, ok, type Result } from '../result';
import { isRateLimited, RATE_LIMITED_MESSAGE } from '../rate-limit';

/**
 * Likes on lists.
 *
 * **In `social/` rather than `lists/`, for the reason `review-likes.ts` gives.**
 * A list like is an interaction with someone else's content. `lists/` owns the
 * list itself; this owns what other people do to it.
 *
 * **No Activity row is written here, and none ever should be.** Likes generate
 * no feed events by decision (`product-spec.md` §4, `data-model.md` §5). They
 * generate a **notification** instead. `list_created` and `list_updated` belong
 * to slice 3 and are not this module's concern.
 *
 * **Two guarantees of different strength, and they must not be conflated.**
 * *One like per user per list* is enforced by the database. *You cannot like
 * your own list* is enforced **here and nowhere else**: a list's owner is
 * `lists.user_id`, a column on a different table, so no check constraint can
 * express it and no trigger is added.
 *
 * > **One consequence differs from `ReviewLike` and is not to be described as
 * > identical.** Because the rule is not a database boundary, a caller writing
 * > directly to the table can still create a self-like. On a review that
 * > inflates nothing a reader sees; **`product-spec.md` §6 requires a like count
 * > on the list page**, so on a list it inflates a displayed number. It remains
 * > a vanity annoyance rather than an integrity or privacy failure
 * > (`data-model.md` §5).
 */

export type ListLike = Database['public']['Tables']['list_likes']['Row'];

export type ListLikeError = 'onboarding_required' | 'self_like' | 'not_found' | 'rate_limited';

/** Postgres unique-violation. Turns a double-submit into a clean outcome. */
const UNIQUE_VIOLATION = '23505';
/** Postgres foreign-key violation. The list does not exist. */
const FOREIGN_KEY_VIOLATION = '23503';
/** PostgREST surfaces an RLS refusal as insufficient privilege. */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Likes a list on behalf of the signed-in user.
 *
 * Idempotent: liking twice returns the original row rather than erroring, which
 * is the treatment `likeReview`, `followUser` and `addWantToListen` all give a
 * repeat.
 *
 * **A list the caller may not read is reported as `not_found`, deliberately.**
 * The write policy defers to `lists_public_read`, so a moderation-removed list
 * is refused with an RLS error rather than a foreign-key one. Both map to the
 * same outcome on purpose: telling a stranger that a removed list exists is
 * itself a disclosure, so "you may not" and "there is no such thing" must be
 * indistinguishable from outside.
 */
export async function likeList(listId: string): Promise<Result<ListLike, ListLikeError>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return err('onboarding_required', 'Choose a handle before liking lists.');
  }

  const supabase = await createClient();

  // The self-like refusal, and the only place it exists. **One flat query,
  // unlike the review path's nested join** — a list's owner is a column on the
  // list itself, which is the one way this relation is simpler than `ReviewLike`.
  const { data: list, error: lookupError } = await supabase
    .from('lists')
    .select('user_id')
    .eq('id', listId)
    .maybeSingle();

  // **A failed lookup must never be read as "not the owner".** Discarding this
  // error would leave `owner` undefined, pass the check below, and let the
  // insert through — and because self-like is deliberately not a database
  // boundary, the database would accept it. A transient fault would then produce
  // exactly the row the rule exists to prevent. It throws rather than returning
  // a `Result` because that is what it is: a database failure, not an outcome
  // the interface renders (`result.ts`).
  if (lookupError) throw lookupError;

  const owner = list?.user_id;
  if (owner === profile.id) {
    return err('self_like', 'You cannot like your own list.');
  }

  const { data, error } = await supabase
    .from('list_likes')
    .insert({ user_id: profile.id, list_id: listId })
    .select()
    .single();

  if (error) {
    // A ceiling, not a fault (`architecture.md` §14.4). Checked first because a
    // rate limit and an existing like are different outcomes, and only one of
    // them means the row is already there.
    if (isRateLimited(error)) return err('rate_limited', RATE_LIMITED_MESSAGE);

    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from('list_likes')
        .select('*')
        .eq('user_id', profile.id)
        .eq('list_id', listId)
        .single();
      if (existing) {
        // The repeat path notifies too, discarded by the unique constraint on
        // `notifications.list_like_id`. Skipping it would lose the notification
        // whenever a first attempt created the like but failed before notifying.
        if (owner) await notify(owner, profile.id, existing.id);
        return ok(existing);
      }
    }
    if (error.code === FOREIGN_KEY_VIOLATION || error.code === INSUFFICIENT_PRIVILEGE) {
      return err('not_found', 'That list is not available.');
    }
    throw error;
  }

  // `owner` is already in scope from the self-like check, so the recipient costs
  // no extra query. A self-like returned before reaching here, which is why a
  // user never receives a notification for their own list.
  if (owner) await notify(owner, profile.id, data.id);
  return ok(data);
}

/**
 * Attempts the like notification without letting it fail the like.
 *
 * **The like is the thing the user asked for; the notification is secondary
 * delivery on top of it** (`architecture.md` §16.3). Identical shape to the
 * follow and review-like paths, and deliberately unlike Activity, which lets its
 * write propagate because a stale activity row makes a false claim where a
 * missing notification only under-delivers.
 */
async function notify(recipientId: string, actorId: string, listLikeId: string): Promise<void> {
  try {
    await recordListLiked(recipientId, actorId, listLikeId);
  } catch (error) {
    console.error('notification failed: list_liked', { listLikeId, error });
  }
}

/**
 * Removes the signed-in user's like.
 *
 * A hard delete, and idempotent — unliking something you have not liked is a
 * no-op rather than an error, which is what makes the control safe to click
 * twice. Re-liking afterwards creates a **new** row with a new id; nothing is
 * revived, and the notification that hung off the old row went with it.
 */
export async function unlikeList(listId: string): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('list_likes')
    .delete()
    .eq('user_id', profile.id)
    .eq('list_id', listId);

  if (error) throw error;
  return ok(null);
}

/**
 * Which of these lists the signed-in user has liked.
 *
 * One query for a whole page rather than one per list, served by the unique
 * constraint's own index, which leads on `user_id`. Returns an empty set for a
 * signed-out visitor and for an empty input, so the caller needs no session
 * branch of its own.
 */
export async function getMyListLikes(listIds: string[]): Promise<Set<string>> {
  if (listIds.length === 0) return new Set();

  const profile = await getCurrentProfile();
  if (!profile) return new Set();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('list_likes')
    .select('list_id')
    .eq('user_id', profile.id)
    .in('list_id', listIds);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.list_id));
}

/**
 * How many people have liked this list.
 *
 * **Through `countRows`, and not a PostgREST aggregate embed.** `architecture.md`
 * §16.2 exists because a `head: true` count against an unresolvable relation
 * returned a confident zero rather than failing — an embed would route around
 * that contract and reintroduce the same silent-zero failure on the one number
 * `product-spec.md` §6 requires this page to display. A real zero still returns
 * zero; a broken relation throws.
 *
 * Served by `list_likes_list_idx`.
 */
export async function listLikeCount(listId: string): Promise<number> {
  const supabase = await createClient();
  // Active likers only (`architecture.md` §16.9), matching the follow counts
  // rather than the unfiltered count this replaced. `!inner` is what makes the
  // status predicate exclude the row instead of nulling the join.
  return countRows(
    supabase
      .from('list_likes')
      .select('id, person:profiles!inner(status)', COUNT_ONLY)
      .eq('list_id', listId)
      .eq('person.status', 'active'),
    'list_likes.count_by_list',
  );
}
