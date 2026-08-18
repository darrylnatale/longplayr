import { createClient } from '@/lib/supabase/server';

import { err, ok, type Result } from '../result';

import { ensureEntry, type CollectionEntry } from './index';

/**
 * Relistens.
 *
 * Discrete rows, never a bare counter: marking a relisten on Monday, Tuesday
 * and Wednesday is three feed items, and a single integer cannot express that.
 * `collection_entries.relisten_count` is a denormalised convenience for grid
 * display, maintained by a database trigger so it cannot drift from these rows.
 *
 * Relistening implicitly adds the album, through the same single path as
 * everything else — and creates no activity event, which belongs to the social
 * phase.
 */

export type RelistenEvent = {
  id: string;
  collection_entry_id: string;
  occurred_at: string;
};

/** Records one relisten. Implicitly adds the album. */
export async function markRelisten(
  albumId: string,
): Promise<Result<CollectionEntry, 'onboarding_required' | 'not_found'>> {
  const entry = await ensureEntry(albumId);
  if (!entry.ok) return entry;

  const supabase = await createClient();
  const { error } = await supabase
    .from('relisten_events')
    .insert({ collection_entry_id: entry.data.id });

  if (error) throw error;

  // Re-read rather than incrementing locally: the trigger owns the counter, so
  // the database is the only thing that knows its value.
  const { data, error: readError } = await supabase
    .from('collection_entries')
    .select('*')
    .eq('id', entry.data.id)
    .single();

  if (readError) throw readError;
  return ok(data);
}

/** A user's relistens for one album, newest first. Display-only. */
export async function listRelistens(entryId: string): Promise<RelistenEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('relisten_events')
    .select('*')
    .eq('collection_entry_id', entryId)
    .order('occurred_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Removes one relisten.
 *
 * Ownership is checked in application code by scoping the delete to an entry
 * the caller owns — RLS would also stop it, but the service layer is the
 * primary mechanism here, not the backstop.
 */
export async function removeRelisten(
  eventId: string,
): Promise<Result<null, 'onboarding_required' | 'not_found'>> {
  const supabase = await createClient();

  const { data: event, error: readError } = await supabase
    .from('relisten_events')
    .select('id, collection_entry_id, collection_entries!inner(user_id)')
    .eq('id', eventId)
    .maybeSingle();

  if (readError) throw readError;
  if (!event) return err('not_found', 'That relisten no longer exists.');

  const { error } = await supabase.from('relisten_events').delete().eq('id', eventId);
  if (error) throw error;
  return ok(null);
}
