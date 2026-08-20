import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

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
 * One pinned album, shaped for the profile's favourites row.
 *
 * Carries no rating, like or relisten count, and that absence is the point: a
 * favourite is a statement about taste rather than a record of listening, and
 * the album may not be in the collection at all. Reading collection state here
 * would imply a relationship the model deliberately does not have.
 */
export type FavouriteListItem = {
  favouriteId: string;
  albumId: string;
  /** 1-10. Gaps are legal — unpinning frees a position without renumbering. */
  position: number;
  mbid: string;
  title: string;
  credit: string;
  hasArtwork: boolean;
};

/**
 * One joined row, flattened for the row component.
 *
 * Exported and pure for the same reason as the collection's mapper: the service
 * itself cannot be called from a test, because `createClient` is cookie-bound
 * and there is no request scope, so the integration suite proves the query and
 * this proves what happens to the rows afterwards.
 */
export function toFavouriteListItem(row: {
  id: string;
  album_id: string;
  position: number;
  albums: {
    mbid: string;
    title: string;
    display_credit: string;
    artwork_status: Database['public']['Enums']['artwork_status'];
  } | null;
}): FavouriteListItem[] {
  if (!row.albums) return [];

  return [
    {
      favouriteId: row.id,
      albumId: row.album_id,
      position: row.position,
      mbid: row.albums.mbid,
      title: row.albums.title,
      credit: row.albums.display_credit,
      // Only `found` means there is an image to fetch; `absent` and `failed`
      // are different facts elsewhere and both draw the placeholder here.
      hasArtwork: row.albums.artwork_status === 'found',
    },
  ];
}

/**
 * A user's pinned albums with the artwork needed to render them, in the order
 * they chose.
 *
 * Separate from `listFavourites`, which returns the raw rows and stays the
 * mutation path's view of the table. This is the profile's view, and it is
 * bounded by the schema rather than by a `limit`: the position check and the
 * per-user unique position cap the table at ten rows by construction, so there
 * is no unbounded read to guard against here as there was for the collection.
 *
 * **Ordered by `position` ascending, and gaps are expected.** Unpinning the
 * third of five leaves 1, 2, 4, 5 rather than renumbering, and `addFavourite`
 * then reuses the lowest free position. Ordering by position rather than by
 * anything else is what makes that arrangement the user's own.
 *
 * Public by decision, like everything else user-generated: this takes a
 * `userId`, applies no viewer filtering, and `anon` holds `select` behind a
 * `for select using (true)` policy.
 *
 * **No collection membership is required or consulted.** A pinned album need
 * never have been listened to.
 */
export async function listProfileFavourites(userId: string): Promise<FavouriteListItem[]> {
  const supabase = await createClient();

  // `favourite_albums.album_id` is the only relationship to `albums`, so this
  // embed needs no foreign-key disambiguation.
  const { data, error } = await supabase
    .from('favourite_albums')
    .select('id, album_id, position, albums(mbid, title, display_credit, artwork_status)')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error) throw error;
  return (data ?? []).flatMap(toFavouriteListItem);
}

/**
 * The signed-in user's favourite row for one album, or null.
 *
 * Mirrors `getMyEntry` deliberately: the album page needs favourite state the
 * same way it needs collection state, and the two are read independently
 * because they **are** independent. A user may hold a favourite for an album
 * they have never collected, so this must never be derived from, or gated on,
 * a collection entry.
 *
 * Returns the row rather than a boolean. The card only needs to know whether it
 * exists, but the row carries the position, and a caller that has it will not
 * have to re-query when ordering eventually gains an interface.
 */
export async function getMyFavourite(albumId: string): Promise<FavouriteAlbum | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('favourite_albums')
    .select('*')
    .eq('user_id', profile.id)
    .eq('album_id', albumId)
    .maybeSingle();

  if (error) throw error;
  return data;
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
