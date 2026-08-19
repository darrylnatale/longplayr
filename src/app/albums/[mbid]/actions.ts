'use server';

import { revalidatePath } from 'next/cache';

import { addToCollection, removeFromCollection } from '@/services/collection';

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
