'use server';

import { revalidatePath } from 'next/cache';

import { addToCollection, rateAlbum, removeFromCollection, setLiked } from '@/services/collection';
import { markRelisten } from '@/services/collection/relistens';

/**
 * Album page mutations.
 *
 * Thin: authorisation, the profile precondition and the Want to Listen clearing
 * rule all live in the service layer, and the entry itself is only ever created
 * through `ensure_collection_entry`. Nothing here talks to Supabase directly.
 *
 * **No activity event is written.** Adding to a collection is decided to
 * generate one, but events do not exist until the social phase, and inventing
 * one here would be building ahead.
 */

export type CollectionActionState = { error?: string };

/**
 * Adds an album. Idempotent — the underlying function upserts, so a double
 * submit or a retried request produces one entry, not two.
 */
export async function addAlbumAction(
  albumId: string,
  _prev: CollectionActionState,
  _formData: FormData,
): Promise<CollectionActionState> {
  const result = await addToCollection(albumId);

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
 * path as everything else — so the wishlist is cleared and no activity event is
 * written.
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
 * canonical path as everything else, so Want to Listen is cleared and no
 * activity event is written.
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
