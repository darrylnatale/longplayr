import { createClient } from '@/lib/supabase/server';

import { err, ok, type Result } from '../result';

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
  return ok(data);
}

/** Deletes the caller's review, leaving the collection entry intact. */
export async function deleteReview(
  albumId: string,
): Promise<Result<null, 'onboarding_required' | 'not_found'>> {
  const entry = await ensureEntry(albumId);
  if (!entry.ok) return entry;

  const supabase = await createClient();
  const { error } = await supabase
    .from('reviews')
    .delete()
    .eq('collection_entry_id', entry.data.id);

  if (error) throw error;
  return ok(null);
}

/**
 * Live reviews for an album, newest first.
 *
 * Removed reviews are excluded here. Their author can still see their own
 * through RLS, so moderation never makes someone's writing vanish without
 * explanation, but they do not appear on the album page.
 */
export async function getAlbumReviews(albumId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reviews')
    .select('*, collection_entries!inner(user_id, album_id, rating)')
    .eq('collection_entries.album_id', albumId)
    .eq('status', 'live')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}
