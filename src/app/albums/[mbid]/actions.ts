'use server';

import { revalidatePath } from 'next/cache';

import { addToCollection, rateAlbum, removeFromCollection, setLiked } from '@/services/collection';
import { markRelisten } from '@/services/collection/relistens';
import { addFavourite, removeFavourite } from '@/services/collection/favourites';
import { REVIEW_MAX_LENGTH, deleteReview, saveReview } from '@/services/collection/reviews';
import { addWantToListen, removeWantToListen } from '@/services/collection/want-to-listen';
import { likeReview, unlikeReview } from '@/services/social/review-likes';

/**
 * Album page mutations.
 *
 * Thin: authorisation, the profile precondition and the Want to Listen clearing
 * rule all live in the service layer, and the entry itself is only ever created
 * through `ensure_collection_entry`. Nothing here talks to Supabase directly.
 *
 * **Activity events are written by the service layer, not here.** An explicit
 * add produces a `listened` event because `addToCollection` is the interactive
 * path; the implicit adds behind rating, liking, relistening and reviewing go
 * through `ensureEntry`, which stays silent. That split is the feed eligibility
 * rule, and it lives in `services/collection` and `services/social/activity.ts`
 * rather than in these actions.
 */

export type CollectionActionState = { error?: string };

/**
 * The optional listen date submitted with an explicit add.
 *
 * **A calendar date, never a timestamp.** `listened_on` is a `date` column and
 * what the user asserts about the past; `added_at` is a `timestamptz` the
 * system sets and never accepts from a form. The two are not interchangeable
 * and this only ever produces the former.
 *
 * Blank means blank. An omitted or empty field yields `null`, which travels to
 * `ensure_collection_entry` as an absent argument, so an add without a date is
 * byte-for-byte the request it was before this field existed.
 *
 * **The round-trip check is not redundant.** `Date.parse('2026-02-30')` returns
 * a number — V8 rolls the day over into March — so parsing alone accepts dates
 * that do not exist, and Postgres then rejects them as out of range and the
 * page 500s. Comparing the parsed components back against the submitted ones is
 * what turns that into a message someone can act on. A browser date input
 * cannot produce such a value; a hand-posted form can.
 *
 * No upper bound is imposed. Whether a listen may be dated in the future is a
 * product question nobody has answered, and inventing a rule here would answer
 * it by implementing it.
 */
function parseListenedOn(
  raw: FormDataEntryValue | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = String(raw ?? '').trim();
  if (value === '') return { ok: true, value: null };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return { ok: false, error: 'Enter the date as YYYY-MM-DD, or leave it blank.' };
  }

  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const real =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  if (!real) return { ok: false, error: 'That date does not exist. Check the day and month.' };
  return { ok: true, value };
}

/**
 * Adds an album, optionally carrying the date the user says they listened.
 *
 * Idempotent — the underlying function upserts, so a double submit or a retried
 * request produces one entry, not two. The date is applied on creation only,
 * inside `ensure_collection_entry`, which is also where the Want to Listen
 * clearing rule lives: adding a date changes which value travels, never which
 * path runs.
 */
export async function addAlbumAction(
  albumId: string,
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const listenedOn = parseListenedOn(formData.get('listenedOn'));
  if (!listenedOn.ok) return { error: listenedOn.error };

  const result = await addToCollection(albumId, listenedOn.value);

  if (!result.ok) {
    // onboarding_required is reachable if a session changes underneath an open
    // page. The card renders it rather than pretending the click worked.
    return { error: result.message };
  }

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/** Removes an album, and with it the review and relistens. The UI warns first. */
export async function removeAlbumAction(
  albumId: string,
  _prev: CollectionActionState,
  _formData: FormData,
): Promise<CollectionActionState> {
  const result = await removeFromCollection(albumId);

  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/**
 * Sets or clears a rating.
 *
 * An empty field clears the rating back to **unrated**, which is `null` — never
 * `0.0`. Those are different claims: one is "I have not scored this", the other
 * is "I scored this zero", and conflating them would both invent an opinion the
 * user never gave and drag the album's average down with it.
 *
 * Rating an album the user does not hold adds it, through the same canonical
 * path as everything else — so the wishlist is cleared, and the implicit add
 * itself stays silent. The `rated` event `rateAlbum` writes belongs to the
 * rating: one per entry, so re-rating edits what the feed already shows.
 * **Clearing the rating removes that event**, since the entry survives and no
 * cascade would.
 */
export async function rateAlbumAction(
  albumId: string,
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  // Clearing carries its own intent rather than an empty `rating` field. A
  // submit button named `rating` would be a *second* entry under that name, and
  // `FormData.get` returns the first — so the input's value won, and clearing
  // silently re-saved the score it was meant to remove.
  const clearing = formData.get('intent') === 'clear';
  const raw = String(formData.get('rating') ?? '').trim();

  let rating: number | null;
  if (clearing || raw === '') {
    rating = null;
  } else {
    const parsed = Number(raw);
    // Number('') is 0 and Number('abc') is NaN; the empty case is handled
    // above, so this only has to reject genuine nonsense.
    if (!Number.isFinite(parsed)) {
      return { error: 'Enter a score between 0.0 and 10.0.' };
    }
    rating = parsed;
  }

  const result = await rateAlbum(albumId, rating);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/**
 * Sets or clears the like.
 *
 * Independent of the rating — a liked album may be unrated, and clearing a
 * score never touches the like. The desired next value travels in the form
 * rather than being derived server-side, so a stale page cannot toggle twice
 * from one click: submitting `liked=true` twice leaves it liked.
 *
 * Liking an album the user does not hold adds it, through the same canonical
 * path as everything else, so Want to Listen is cleared and no activity event
 * is written.
 */
export async function toggleLikeAction(
  albumId: string,
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const liked = formData.get('liked') === 'true';

  const result = await setLiked(albumId, liked);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/**
 * Records one relisten.
 *
 * Deliberately **not** idempotent, unlike every other mutation on this page.
 * Marking a relisten on Monday, Tuesday and Wednesday is three separate events
 * and, later, three feed items — a counter alone could not express that, which
 * is why `relisten_events` holds rows and `relisten_count` is derived from them
 * by a database trigger rather than incremented here.
 *
 * Relistening an album the user does not hold adds it, through the same
 * canonical path as everything else, so Want to Listen is cleared. The implicit
 * add itself is silent; the `relistened` event `markRelisten` writes belongs to
 * the relisten, not to the add.
 */
export async function markRelistenAction(
  albumId: string,
  _prev: CollectionActionState,
  _formData: FormData,
): Promise<CollectionActionState> {
  const result = await markRelisten(albumId);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/**
 * Creates or replaces the caller's review.
 *
 * Writing about an album implicitly adds it, through the same canonical path as
 * everything else, so the wishlist is cleared. The implicit add is silent and
 * the `reviewed` event `saveReview` writes belongs to the review — one per
 * review, so editing changes what the feed shows rather than announcing it
 * again.
 *
 * Whitespace-only bodies are rejected and the stored body is trimmed. The limit
 * is enforced three times over — `maxLength` on the field, this check, and a
 * check constraint — because the outer two produce a message a person can act
 * on and the innermost one is the guarantee.
 */
export async function saveReviewAction(
  albumId: string,
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const body = String(formData.get('body') ?? '');

  if (body.trim().length === 0) {
    return { error: 'A review needs some words in it.' };
  }
  if (body.trim().length > REVIEW_MAX_LENGTH) {
    return { error: `Reviews are capped at ${REVIEW_MAX_LENGTH.toLocaleString()} characters.` };
  }

  const result = await saveReview(albumId, body);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/**
 * Deletes the caller's review. A hard delete, by decision.
 *
 * Never creates a collection entry and never clears Want to Listen — deleting
 * writing is not a reason to collect anything. The service enforces that; this
 * only routes to it.
 */
export async function deleteReviewAction(
  albumId: string,
  _prev: CollectionActionState,
  _formData: FormData,
): Promise<CollectionActionState> {
  const result = await deleteReview(albumId);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/**
 * Pins or unpins a favourite.
 *
 * **Neither direction touches the collection.** Pinning does not add the album
 * and unpinning does not remove it — a favourite is a statement about taste,
 * not a record of listening (product-spec.md §8.5, which names favourites as
 * the one exception to implicit collection). This action therefore does not go
 * through `ensureEntry`, and that omission is the decision rather than an
 * oversight: every other mutation on this page collects, and this one must not.
 *
 * The desired next value travels in the form rather than being derived from
 * what the server currently holds, exactly as the like does, so a stale page
 * cannot toggle twice from one click. Submitting `favourited=true` twice leaves
 * it pinned rather than pinning and immediately unpinning.
 *
 * The ten-favourite cap comes back as a rendered message rather than a throw:
 * `addFavourite` returns `favourites_full`, and the schema is what actually
 * guarantees the ceiling if two requests race past the service's count.
 */
export async function toggleFavouriteAction(
  albumId: string,
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const favourited = formData.get('favourited') === 'true';

  const result = favourited ? await addFavourite(albumId) : await removeFavourite(albumId);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

/**
 * Adds or removes the album from the caller's Want to Listen list.
 *
 * **Touches nothing else, in either direction.** No `ensureEntry`, no rating,
 * like, relisten or review. Wanting an album is a statement of intent and
 * creates no collection entry; unwanting it removes none. The relations are
 * independent (product-spec.md §10.1), and this action is the only mutation on
 * the page that neither collects nor reads collection state.
 *
 * **The one-way rule still applies, and still lives elsewhere.** Adding the
 * album to the collection later clears the wishlist row, inside
 * `ensure_collection_entry` on the path that creates the entry. That is not
 * duplicated here, and must not be: the rule fires on creation, and this
 * function never creates anything.
 *
 * The desired next value travels in the form rather than being derived from
 * what the server holds, matching the like and the favourite, so a stale page
 * cannot toggle twice from one click. Adding is idempotent in the service, so
 * submitting `wanted=true` twice leaves one row rather than erroring.
 *
 * **Still no activity event, and the reason has changed.** Activity exists now,
 * but Want to Listen is deliberately not among its types: whether *removing*
 * generates an event is `[OPEN]` (`product-spec.md` §10.1), and writing the
 * addition while that is unanswered would settle half a question by
 * implementing it.
 */
/**
 * Likes or unlikes someone else's review.
 *
 * **The action chooses, the service acts** — the desired state arrives in the
 * form, exactly as `toggleWantToListenAction` and `toggleFavouriteAction` do.
 * No new action protocol.
 *
 * **Errors here are a backstop, not the mechanism.** The album page renders no
 * control for a signed-out visitor or for the review's own author, so
 * `onboarding_required` and `self_like` should be unreachable through the
 * interface. They are returned rather than thrown because a stale page can
 * still post one.
 */
export async function toggleReviewLikeAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const reviewId = String(formData.get('reviewId') ?? '');
  const liked = formData.get('liked') === 'true';

  const result = liked ? await likeReview(reviewId) : await unlikeReview(reviewId);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}

export async function toggleWantToListenAction(
  albumId: string,
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const wanted = formData.get('wanted') === 'true';

  const result = wanted ? await addWantToListen(albumId) : await removeWantToListen(albumId);
  if (!result.ok) return { error: result.message };

  revalidatePath(`/albums/[mbid]`, 'page');
  return {};
}
