import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { getCurrentProfile } from '../profiles';
import { recordReviewLiked } from './notifications';
import { err, ok, type Result } from '../result';
import { isRateLimited, RATE_LIMITED_MESSAGE } from '../rate-limit';

/**
 * Likes on reviews.
 *
 * **In `social/` rather than `collection/`, and the distinction is the point.**
 * A review like is an interaction with someone else's content, which is what
 * this module holds. `collection_entries.liked` — the album like — stays in
 * `collection/` because it is your own collection state. They share a word and
 * almost nothing else.
 *
 * **No Activity row is written here, and none ever should be.** Likes generate
 * no feed events by decision (`product-spec.md` §4, `data-model.md` §5): they
 * would dominate by volume and crowd out reviews. They generate a
 * **notification** instead, which is the only way a like becomes visible to its
 * recipient at all. **[UPDATED 2026-09-03]** That notification now exists; this
 * comment previously said it did not.
 *
 * **The notification is best-effort and the like is authoritative.** A
 * notification failure is caught and logged rather than turning a like that
 * happened into an error — `architecture.md` §16.3, and deliberately unlike
 * Activity, which lets its write propagate.
 *
 * **Two guarantees of different strength, and they must not be conflated.**
 * *One like per user per review* is enforced by the database, by
 * `review_likes_one_per_user_per_review`. *You cannot like your own review* is
 * enforced **here and nowhere else**: a review's author is not a column on the
 * like, so no check constraint can express it, and no trigger is added for it.
 * The first is an integrity boundary. The second is a courtesy, and calling it
 * anything stronger would be false.
 */

export type ReviewLike = Database['public']['Tables']['review_likes']['Row'];

export type ReviewLikeError = 'onboarding_required' | 'self_like' | 'not_found' | 'rate_limited';

/** Postgres unique-violation. Turns a double-submit into a clean outcome. */
const UNIQUE_VIOLATION = '23505';
/** Postgres foreign-key violation. The review does not exist. */
const FOREIGN_KEY_VIOLATION = '23503';
/** PostgREST surfaces an RLS refusal as insufficient privilege. */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Likes a review on behalf of the signed-in user.
 *
 * Idempotent: liking twice returns the original row rather than erroring, so a
 * double submit or a retried request produces one row — the same treatment
 * `followUser` and `addWantToListen` give a repeat.
 *
 * **A review the caller may not read is reported as `not_found`, deliberately.**
 * The write policy defers to `reviews_public_read`, so a moderation-removed
 * review is refused with an RLS error rather than a foreign-key one. Both map to
 * the same outcome on purpose: telling a stranger that a removed review exists
 * is itself a disclosure, so "you may not" and "there is no such thing" must be
 * indistinguishable from outside.
 */
export async function likeReview(reviewId: string): Promise<Result<ReviewLike, ReviewLikeError>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return err('onboarding_required', 'Choose a handle before liking reviews.');
  }

  const supabase = await createClient();

  // The self-like refusal, and the only place it exists. It reads the review's
  // author rather than trusting the caller, and it is a courtesy rather than a
  // guarantee — the database will happily accept a self-like if this is skipped.
  const { data: review, error: lookupError } = await supabase
    .from('reviews')
    .select('id, collection_entries!inner(user_id)')
    .eq('id', reviewId)
    .maybeSingle();

  // **A failed lookup must never be read as "not the author".** Discarding this
  // error would leave `author` undefined, pass the check below, and let the
  // insert through — and because self-like is deliberately not a database
  // boundary, the database would accept it. A transient fault would then produce
  // exactly the row the rule exists to prevent.
  //
  // It throws rather than returning a `Result` because that is what it is: a
  // database failure, not an outcome the interface renders. `result.ts` draws
  // that line — "genuinely unexpected failures (database down, bug) still
  // throw" — and the other two queries in this file already handle it this way.
  if (lookupError) throw lookupError;

  const author = (review?.collection_entries as unknown as { user_id: string } | undefined)
    ?.user_id;
  if (author === profile.id) {
    return err('self_like', 'You cannot like your own review.');
  }

  const { data, error } = await supabase
    .from('review_likes')
    .insert({ user_id: profile.id, review_id: reviewId })
    .select()
    .single();

  if (error) {
    // A ceiling, not a fault (`architecture.md` §14.4). Checked first because a
    // rate limit and an existing like are different outcomes, and only one of
    // them means the row is already there.
    if (isRateLimited(error)) return err('rate_limited', RATE_LIMITED_MESSAGE);

    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from('review_likes')
        .select('*')
        .eq('user_id', profile.id)
        .eq('review_id', reviewId)
        .single();
      if (existing) {
        // The repeat path notifies too, discarded by the unique constraint on
        // `notifications.review_like_id`. Skipping it would lose the
        // notification whenever a first attempt created the like but failed
        // before notifying.
        if (author) await notify(author, profile.id, existing.id);
        return ok(existing);
      }
    }
    if (error.code === FOREIGN_KEY_VIOLATION || error.code === INSUFFICIENT_PRIVILEGE) {
      return err('not_found', 'That review is not available.');
    }
    throw error;
  }

  // `author` is already in scope from the self-like check above, so the
  // recipient costs no extra query. A self-like returned before reaching here,
  // which is why a user never receives a notification for their own review.
  if (author) await notify(author, profile.id, data.id);
  return ok(data);
}

/**
 * Attempts the like notification without letting it fail the like.
 *
 * **The like is the thing the user asked for; the notification is secondary
 * delivery on top of it** (`architecture.md` §16.3). Identical reasoning and
 * identical shape to the follow path, and deliberately unlike Activity, which
 * lets its write propagate because a stale activity row makes a false claim
 * where a missing notification only under-delivers.
 *
 * The contract is best-effort delivery. It is not guaranteed.
 */
async function notify(recipientId: string, actorId: string, reviewLikeId: string): Promise<void> {
  try {
    await recordReviewLiked(recipientId, actorId, reviewLikeId);
  } catch (error) {
    console.error('notification failed: review_liked', { reviewLikeId, error });
  }
}

/**
 * Removes the signed-in user's like.
 *
 * A hard delete, and idempotent — unliking something you have not liked is a
 * no-op rather than an error, which is what makes the control safe to click
 * twice. Re-liking afterwards creates a **new** row with a new id; nothing is
 * revived. The Notifications slice inherits that: a notification hanging off a
 * like cascades away when the like goes, and a re-like is a new event.
 */
export async function unlikeReview(reviewId: string): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('review_likes')
    .delete()
    .eq('user_id', profile.id)
    .eq('review_id', reviewId);

  if (error) throw error;
  return ok(null);
}

/**
 * Which of these reviews the signed-in user has liked.
 *
 * One query for the whole page rather than one per review, served by the unique
 * constraint's own index — it leads on `user_id`, which is exactly this shape.
 *
 * Returns an empty set for a signed-out visitor and for an empty input, so the
 * caller needs no session branch of its own. **The album page reads social state
 * through here rather than through `getAlbumReviews`**, which keeps a social
 * read out of the collection module.
 */
export async function getMyReviewLikes(reviewIds: string[]): Promise<Set<string>> {
  if (reviewIds.length === 0) return new Set();

  const profile = await getCurrentProfile();
  if (!profile) return new Set();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('review_likes')
    .select('review_id')
    .eq('user_id', profile.id)
    .in('review_id', reviewIds);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.review_id));
}
