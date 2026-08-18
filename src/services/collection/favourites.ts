import { createClient } from '@/lib/supabase/server';

import { getCurrentProfile } from '../profiles';
import { err, ok, type Result } from '../result';

import { MAX_FAVOURITES, type FavouriteAlbum } from './index';

/**
 * Favourites.
 *
 * **Independent of the collection** (decision C). You may pin an album you have
 * not added, and pinning does not add it — a favourite is a statement about
 * taste, not a record of listening. Nothing here calls `ensureEntry`, and that
 * omission is the decision.
 *
 * Capped at ten. The cap is enforced twice on purpose: this service returns a
 * clean `favourites_full` outcome, and the schema caps the table at ten rows by
 * construction through a 1-10 position check plus a per-user unique position.
 * A count-then-insert check alone is racy — two concurrent requests can each
 * observe nine — so the constraint is the guarantee and this is the good error
 * message. The same division of labour as handle uniqueness.
 */

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

export type FavouriteError = 'onboarding_required' | 'favourites_full' | 'not_found';

/** A user's pinned albums, in their chosen order. */
export async function listFavourites(userId: string): Promise<FavouriteAlbum[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('favourite_albums')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Pins an album at the next free position.
 *
 * Does **not** create a collection entry.
 */
export async function addFavourite(
  albumId: string,
): Promise<Result<FavouriteAlbum, FavouriteError>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return err('onboarding_required', 'Choose a handle before pinning favourites.');
  }

  const supabase = await createClient();
  const existing = await listFavourites(profile.id);

  if (existing.some((f) => f.album_id === albumId)) {
    const already = existing.find((f) => f.album_id === albumId)!;
    return ok(already);
  }
  if (existing.length >= MAX_FAVOURITES) {
    return err('favourites_full', `You can pin up to ${MAX_FAVOURITES} favourites.`);
  }

  // Lowest unused position, so removing the third and adding another reuses
  // the gap rather than pushing past ten.
  const taken = new Set(existing.map((f) => f.position));
  let position = 1;
  while (taken.has(position)) position += 1;

  const { data, error } = await supabase
    .from('favourite_albums')
    .insert({ user_id: profile.id, album_id: albumId, position })
    .select()
    .single();

  if (error) {
    // The schema is the real cap. A race that gets past the count check above
    // lands here, and it is still a clean outcome rather than a crash.
    if (error.code === CHECK_VIOLATION || error.code === UNIQUE_VIOLATION) {
      return err('favourites_full', `You can pin up to ${MAX_FAVOURITES} favourites.`);
    }
    throw error;
  }
  return ok(data);
}

/** Unpins an album. Leaves any collection entry untouched. */
export async function removeFavourite(
  albumId: string,
): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('favourite_albums')
    .delete()
    .eq('user_id', profile.id)
    .eq('album_id', albumId);

  if (error) throw error;
  return ok(null);
}
