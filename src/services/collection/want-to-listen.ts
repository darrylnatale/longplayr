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
 * Deliberately not decided, and therefore not implemented: whether this is
 * visible on public profiles, whether removal generates an event, whether it
 * feeds discovery ranking, and whether the interface should offer it for an
 * album already collected (docs/data-model.md §11.3, §11.8, §11.9).
 */

const UNIQUE_VIOLATION = '23505';

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
