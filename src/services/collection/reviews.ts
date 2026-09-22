import { createClient } from '@/lib/supabase/server';

import { getCurrentProfile } from '../profiles';
import { err, ok, type Result } from '../result';

import { recordReviewed } from '../social/activity';
import { ensureEntry, type Review } from './index';

/**
 * Reviews.
 *
 * One standing review per collection entry, editable in place, with no version
 * history. Its own table rather than a column on the entry, because moderation
 * must be able to remove a review without destroying the user's collection
 * record, and because likes and reports will need a stable identifier.
 *
 * Plain text with line breaks, capped at 10,000 characters. No Markdown and no
 * spoiler mechanism, both by decision.
 *
 * Writing a review implicitly adds the album, through the single path. Review
 * likes are not part of this phase.
 *
 * **Two invariants are decided rather than incidental**, and both are pinned by
 * test because either could be broken by a change that looks like a
 * simplification:
 *
 *  - **Editing preserves identity.** `id` and `created_at` survive an edit.
 *    Phase 3 hangs review likes, notifications and reports off the review id,
 *    so a delete-and-insert would satisfy every visible behaviour and silently
 *    orphan all three. The `upsert` resolves to `insert … on conflict do
 *    update`, which keeps the row.
 *  - **Author deletion is a hard delete.** `status = 'removed'` is a moderation
 *    state, not the mechanism for someone removing their own writing.
 */

export const REVIEW_MAX_LENGTH = 10_000;

export type ReviewError = 'onboarding_required' | 'not_found' | 'invalid_review';

/** Creates or replaces the caller's review for an album. */
export async function saveReview(
  albumId: string,
  body: string,
): Promise<Result<Review, ReviewError>> {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return err('invalid_review', 'A review needs some text.');
  }
  if (trimmed.length > REVIEW_MAX_LENGTH) {
    return err('invalid_review', `Reviews are capped at ${REVIEW_MAX_LENGTH} characters.`);
  }

  const entry = await ensureEntry(albumId);
  if (!entry.ok) return entry;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      { collection_entry_id: entry.data.id, body: trimmed },
      { onConflict: 'collection_entry_id' },
    )
    .select()
    .single();

  if (error) throw error;

  // One per review. Editing changes what the existing event displays rather
  // than announcing the review again.
  await recordReviewed(entry.data.user_id, data.id);

  return ok(data);
}

/**
 * Deletes the caller's review. A hard delete, by decision A.
 *
 * **Deliberately does not go through `ensureEntry`.** It used to, which meant
 * deleting a review you did not have, on an album you did not hold, created a
 * collection entry and cleared your Want to Listen row. Deleting is not a
 * reason to collect anything: this looks the entry up and does nothing when
 * there isn't one.
 *
 * Safe to call when there is nothing there, like removal from the collection.
 */
export async function deleteReview(albumId: string): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();
  const { data: entry, error: lookupError } = await supabase
    .from('collection_entries')
    .select('id')
    .eq('user_id', profile.id)
    .eq('album_id', albumId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  // No entry means no review. Nothing to delete, and nothing to create.
  if (!entry) return ok(null);

  const { error } = await supabase.from('reviews').delete().eq('collection_entry_id', entry.id);

  if (error) throw error;
  return ok(null);
}

/**
 * One review as an album page needs it: the writing, the author, and the score
 * they gave the same album.
 *
 * The score travels with the review because they are one statement — a review
 * beside its author's own rating reads very differently from a review floating
 * free of it.
 */
export type AlbumReview = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** The author's own score for this album, if they gave one. */
  rating: number | null;
  author: {
    id: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

/**
 * Live reviews for an album, newest first.
 *
 * **Carries author identity.** A review reaches its author through
 * `collection_entries.user_id`, which references `profiles(id)`; without the
 * embed the result is unrenderable, since there is no handle to attribute it
 * to. Only one relationship exists between those tables, so the embed needs no
 * disambiguation — unlike `releases` from `albums`.
 *
 * Removed reviews are excluded here. Their author can still read their own
 * through RLS, so moderation never makes someone's writing vanish without
 * explanation, but they do not appear on the album page. **The moderation
 * visibility rules are unchanged by this function.**
 */
export async function getAlbumReviews(albumId: string): Promise<AlbumReview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reviews')
    // One literal string, not a concatenation: PostgREST infers the row type
    // from the select text, and anything it cannot read statically collapses to
    // an error type.
    .select(
      `id, body, created_at, updated_at, collection_entries!inner(album_id, rating, profiles!inner(id, handle, display_name, avatar_url, status))`,
    )
    .eq('collection_entries.album_id', albumId)
    .eq('status', 'live')
    // The review's own status was always filtered; its author's never was, so a
    // suspended account's review stayed on every album page — handle, avatar
    // and a link to a profile that 404s. `architecture.md` §16.9.
    .eq('collection_entries.profiles.status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const entry = row.collection_entries as unknown as {
      rating: number | null;
      profiles: {
        id: string;
        handle: string;
        display_name: string | null;
        avatar_url: string | null;
      };
    };
    return {
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rating: entry.rating === null ? null : Number(entry.rating),
      author: {
        id: entry.profiles.id,
        handle: entry.profiles.handle,
        displayName: entry.profiles.display_name,
        avatarUrl: entry.profiles.avatar_url,
      },
    };
  });
}
