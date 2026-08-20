import { createClient } from '@/lib/supabase/server';

import { getCurrentProfile } from '../profiles';
import { err, ok, type Result } from '../result';

import type { WantToListenRow } from './index';

/**
 * Want to Listen.
 *
 * Intent, not history, and an **independent relation** from the collection: an
 * album may legally sit in both, and nothing here or in the schema prevents it.
 *
 * The clearing rule — any action that causes a collection entry to exist clears
 * Want to Listen for that album — lives in `ensure_collection_entry`, not here.
 * It is **one-directional**: it does not run in reverse, and it does not fire
 * when a wishlist row is created. So adding an album you already hold leaves it
 * in both relations, which is legal and deliberate.
 *
 * **No activity event is written.** Want to Listen additions are decided to
 * generate a feed event, but events do not exist until the social phase, and
 * inventing one here would be building ahead.
 *
 * **Resolved, and now implemented by the album card:** the interface offers
 * this on an album already collected. The relations are independent, so a user
 * may hold both; the card therefore shows the control in every collection
 * state and never derives one relation from the other.
 *
 * **Resolved, and deliberately not implemented here:** Want to Listen is public
 * on the profile, as its own tab (`product-spec.md` §10.1). That fixes the
 * eventual structure; it does not schedule the surface, and no wishlist route
 * or profile section exists.
 *
 * Still undecided, and still to be asked rather than inferred: whether removal
 * generates a feed event, whether this feeds discovery or popularity ranking,
 * and whether the activity can be hidden from the feed. All three are Phase 3
 * or later — none is reachable while Activity does not exist.
 */

const UNIQUE_VIOLATION = '23505';

/**
 * The signed-in user's wishlist row for one album, or null.
 *
 * Mirrors `getMyFavourite`, and for the same reason: the album card needs this
 * relation's state the way it needs collection state, and the two are read
 * independently because they **are** independent. An album may be wanted while
 * uncollected, collected while unwanted, or — legally, though the common path
 * never produces it — both at once. This must therefore never be derived from,
 * or gated on, a collection entry.
 *
 * Returns the row rather than a boolean, matching the sibling read. The card
 * only needs existence, but `added_at` is on the row and a later surface that
 * orders by it will not have to re-query.
 */
export async function getMyWantToListen(albumId: string): Promise<WantToListenRow | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('want_to_listen')
    .select('*')
    .eq('user_id', profile.id)
    .eq('album_id', albumId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Adds an album to the caller's wishlist. Idempotent. */
export async function addWantToListen(
  albumId: string,
): Promise<Result<WantToListenRow, 'onboarding_required' | 'not_found'>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return err('onboarding_required', 'Choose a handle before saving albums to hear.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('want_to_listen')
    .insert({ user_id: profile.id, album_id: albumId })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from('want_to_listen')
        .select('*')
        .eq('user_id', profile.id)
        .eq('album_id', albumId)
        .single();
      if (existing) return ok(existing);
    }
    if (error.code === '23503') return err('not_found', 'That album is not in the catalogue.');
    throw error;
  }
  return ok(data);
}

/** Removes an album from the caller's wishlist. */
export async function removeWantToListen(
  albumId: string,
): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('want_to_listen')
    .delete()
    .eq('user_id', profile.id)
    .eq('album_id', albumId);

  if (error) throw error;
  return ok(null);
}

/** A user's wishlist, newest first. */
export async function listWantToListen(userId: string): Promise<WantToListenRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('want_to_listen')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}
