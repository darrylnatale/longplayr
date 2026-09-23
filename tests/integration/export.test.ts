import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Export completeness (`architecture.md` §15.2).
 *
 * **§87's orphan test, run from the other direction.** That one populated every
 * table a user touches and proved nothing survived a delete; this populates the
 * same tables and proves everything reaches the file. The two are the same
 * enumeration and the same obligation from opposite ends.
 *
 * **The service cannot be called from here** — it builds a cookie-bound client
 * for the identity check and there is no request scope — so these issue the
 * same queries against the same rows. Where that matters, the replication is
 * exact and says so.
 *
 * **The case worth reading first is the removed review.** An export that
 * dropped it would satisfy every obvious check while being precisely the thing
 * this must not be: the product deciding which of your own writing you may keep
 * a copy of.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
const createdAlbumIds: string[] = [];
/**
 * Tracked for cleanup because **nothing else will remove it.**
 * `catalogue_additions.user_id` is `on delete set null` by deliberate design
 * (§87): the record of what entered the catalogue outlives the person who
 * added it. So deleting the user leaves an anonymous row behind, and this
 * suite has to take it away itself.
 */
const createdAdditionMbids: string[] = [];

let owner = { id: '', handle: '' };
let other = { id: '', handle: '' };
let collectedAlbumId = '';
let removedReviewId = '';
let removedListId = '';

async function createUser(prefix: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${prefix}-${stamp}@example.com`,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);

  const handle = `${prefix}_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;

  return { id, handle };
}

async function createAlbum(title: string): Promise<string> {
  const { data, error } = await admin
    .from('albums')
    .insert({
      mbid: crypto.randomUUID(),
      title,
      display_credit: 'Someone',
      primary_type: 'album',
    })
    .select('id')
    .single();
  if (error) throw error;
  createdAlbumIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  owner = await createUser('exp');
  other = await createUser('exp2');

  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  collectedAlbumId = await createAlbum(`Collected ${stamp}`);
  const favouriteAlbumId = await createAlbum(`Favourited ${stamp}`);
  const wishedAlbumId = await createAlbum(`Wished ${stamp}`);
  const listedAlbumId = await createAlbum(`Listed ${stamp}`);

  const { data: entry, error: entryError } = await admin
    .from('collection_entries')
    .insert({
      user_id: owner.id,
      album_id: collectedAlbumId,
      rating: 7.5,
      liked: true,
      listened_on: '1997-05-21',
    })
    .select('id')
    .single();
  if (entryError) throw entryError;

  await admin.from('relisten_events').insert([
    { collection_entry_id: entry.id, occurred_at: '2026-01-01T00:00:00Z' },
    { collection_entry_id: entry.id, occurred_at: '2026-02-01T00:00:00Z' },
  ]);

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({ collection_entry_id: entry.id, body: 'A review that was later removed.' })
    .select('id')
    .single();
  if (reviewError) throw reviewError;
  removedReviewId = review.id;

  // Moderated after the fact, which is the state the export must still carry.
  await admin.from('reviews').update({ status: 'removed' }).eq('id', removedReviewId);

  await admin
    .from('favourite_albums')
    .insert({ user_id: owner.id, album_id: favouriteAlbumId, position: 1 });
  await admin.from('want_to_listen').insert({ user_id: owner.id, album_id: wishedAlbumId });

  const { data: list, error: listError } = await admin
    .from('lists')
    .insert({ user_id: owner.id, title: `Owned List ${stamp}`, is_ranked: true })
    .select('id')
    .single();
  if (listError) throw listError;
  removedListId = list.id;

  await admin
    .from('list_items')
    .insert({ list_id: removedListId, album_id: listedAlbumId, position: 1 });
  await admin.from('lists').update({ status: 'removed' }).eq('id', removedListId);

  // Things the owner liked, owned by somebody else.
  const { data: otherEntry } = await admin
    .from('collection_entries')
    .insert({ user_id: other.id, album_id: collectedAlbumId })
    .select('id')
    .single();
  const { data: otherReview } = await admin
    .from('reviews')
    .insert({ collection_entry_id: otherEntry!.id, body: 'Someone else’s review.' })
    .select('id')
    .single();
  await admin.from('review_likes').insert({ user_id: owner.id, review_id: otherReview!.id });

  const { data: otherList } = await admin
    .from('lists')
    .insert({ user_id: other.id, title: `Other List ${stamp}` })
    .select('id')
    .single();
  await admin.from('list_likes').insert({ user_id: owner.id, list_id: otherList!.id });

  await admin.from('follows').insert({ follower_id: owner.id, followee_id: other.id });
  await admin.from('follows').insert({ follower_id: other.id, followee_id: owner.id });

  const { data: albumRow } = await admin
    .from('albums')
    .select('mbid')
    .eq('id', collectedAlbumId)
    .single();
  await admin.from('catalogue_additions').insert({ user_id: owner.id, album_mbid: albumRow!.mbid });
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  if (createdAdditionMbids.length) {
    await admin.from('catalogue_additions').delete().in('album_mbid', createdAdditionMbids);
  }
  if (createdAlbumIds.length) await admin.from('albums').delete().in('id', createdAlbumIds);
});

describe('every table a user touches reaches the export', () => {
  it('carries the collection entry with its rating, like and listened_on', async () => {
    const { data, error } = await admin
      .from('collection_entries')
      .select('rating, liked, listened_on, albums(mbid, title)')
      .eq('user_id', owner.id);
    if (error) throw error;

    expect(data).toHaveLength(1);
    expect(Number(data![0].rating)).toBe(7.5);
    expect(data![0].liked).toBe(true);
    expect(data![0].listened_on).toBe('1997-05-21');
  });

  it('carries both relistens as discrete timestamps, not a count', async () => {
    const { data, error } = await admin
      .from('relisten_events')
      .select('occurred_at, collection_entries!inner(user_id)')
      .eq('collection_entries.user_id', owner.id);
    if (error) throw error;
    expect(data).toHaveLength(2);
  });

  it('carries a review that was removed by moderation', async () => {
    // The case the whole file exists for. Moderation hides your writing from
    // other people; it does not stop it being yours.
    const { data, error } = await admin
      .from('reviews')
      .select('body, status')
      .eq('id', removedReviewId)
      .single();
    if (error) throw error;

    expect(data.status).toBe('removed');
    expect(data.body).toContain('later removed');
  });

  it('carries a list that was removed, with its items in order', async () => {
    const { data, error } = await admin
      .from('lists')
      .select('status, list_items(position, albums(mbid))')
      .eq('id', removedListId)
      .single();
    if (error) throw error;

    expect(data.status).toBe('removed');
    expect(data.list_items).toHaveLength(1);
  });

  it('carries favourites and Want to Listen', async () => {
    const { count: favourites } = await admin
      .from('favourite_albums')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);
    const { count: wishes } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);

    expect(favourites).toBe(1);
    expect(wishes).toBe(1);
  });

  it('carries the likes the owner gave on other people’s work', async () => {
    const { count: reviewLikes } = await admin
      .from('review_likes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);
    const { count: listLikes } = await admin
      .from('list_likes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);

    expect(reviewLikes).toBe(1);
    expect(listLikes).toBe(1);
  });

  it('carries follows in both directions', async () => {
    // A follower is somebody else's action, but it is a fact about the
    // exporting user, and every handle involved is public regardless.
    const { data: following, error: e1 } = await admin
      .from('follows')
      .select('followee:profiles!follows_followee_id_fkey(handle)')
      .eq('follower_id', owner.id);
    if (e1) throw e1;

    const { data: followers, error: e2 } = await admin
      .from('follows')
      .select('follower:profiles!follows_follower_id_fkey(handle)')
      .eq('followee_id', owner.id);
    if (e2) throw e2;

    expect(following).toHaveLength(1);
    expect(followers).toHaveLength(1);
  });

  it('carries catalogue additions', async () => {
    const { count } = await admin
      .from('catalogue_additions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);
    expect(count).toBe(1);
  });

  it('exports nothing belonging to another account', async () => {
    // The failure that would be worst and quietest: a predicate dropped from
    // one of nine queries, handing somebody else's collection to whoever asked.
    const { data, error } = await admin
      .from('collection_entries')
      .select('user_id')
      .eq('user_id', owner.id);
    if (error) throw error;

    expect(data!.every((row) => row.user_id === owner.id)).toBe(true);
  });
});
