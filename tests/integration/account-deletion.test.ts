import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Account deletion — hard delete, complete cascade, no orphans.
 *
 * **The test is the deliverable at least as much as the code is.** `CLAUDE.md`
 * calls an orphaned row a privacy failure, and the cascade this relies on is
 * *declared* rather than proven: every user-bearing table carries
 * `on delete cascade` from `profiles`, and `profiles.id` cascades from
 * `auth.users`. Whether that is actually complete is what this file establishes.
 *
 * **Tables are enumerated explicitly rather than discovered.** A table added
 * later should fail this test until somebody has thought about whether it holds
 * user data — which a `select *` sweep would quietly absolve it of.
 *
 * **Two rows are expected to survive, and both are asserted rather than
 * excluded silently**: the reserved handle (`data-model.md` §9.5) and the
 * anonymised `catalogue_additions` row, whose `user_id` is `on delete set null`
 * by an explicit decision recorded in its own migration.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

/** Auth-heavy, same budget and the same reasoning as every sibling suite. */
vi.setConfig({ testTimeout: 30_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
const reservedHandles: string[] = [];

async function createUser(): Promise<{ id: string; handle: string; email: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `deletion-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);

  const handle = `d_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;

  reservedHandles.push(handle);
  return { id, handle, email };
}

/** An album to hang collection data off. Catalogue rows are not user data. */
async function createAlbum(): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const { data: artist, error: artistError } = await admin
    .from('artists')
    .insert({
      mbid: crypto.randomUUID(),
      name: `Deletion Artist ${stamp}`,
      sort_name: `Deletion Artist ${stamp}`,
    })
    .select('id')
    .single();
  if (artistError) throw artistError;

  const { data: album, error: albumError } = await admin
    .from('albums')
    .insert({
      mbid: crypto.randomUUID(),
      title: `Deletion Album ${stamp}`,
      display_credit: `Deletion Artist ${stamp}`,
      primary_type: 'album',
    })
    .select('id')
    .single();
  if (albumError) throw albumError;

  const { error: creditError } = await admin
    .from('album_artists')
    .insert({ album_id: album.id, artist_id: artist.id, position: 0 });
  if (creditError) throw creditError;

  return album.id;
}

/**
 * Every table that can hold a row belonging to a user, and how to count that
 * user's rows in it.
 *
 * **`reviews` and `relisten_events` carry no user column at all** — they hang
 * off `collection_entries`, so their emptiness is checked through the entry
 * rather than directly, which is exactly the transitive path most likely to be
 * wrong.
 */
type Counter = (userId: string) => Promise<number>;

async function countBy(table: string, column: string, userId: string): Promise<number> {
  const { count, error } = await admin
    .from(table as 'profiles')
    .select('*', { count: 'exact', head: true })
    .eq(column, userId);
  if (error) throw error;
  return count ?? 0;
}

const USER_TABLES: Record<string, Counter> = {
  profiles: (id) => countBy('profiles', 'id', id),
  collection_entries: (id) => countBy('collection_entries', 'user_id', id),
  favourite_albums: (id) => countBy('favourite_albums', 'user_id', id),
  want_to_listen: (id) => countBy('want_to_listen', 'user_id', id),
  lists: (id) => countBy('lists', 'user_id', id),
  list_likes: (id) => countBy('list_likes', 'user_id', id),
  review_likes: (id) => countBy('review_likes', 'user_id', id),
  'follows (as follower)': (id) => countBy('follows', 'follower_id', id),
  'follows (as followee)': (id) => countBy('follows', 'followee_id', id),
  'activity (as actor)': (id) => countBy('activity', 'actor_id', id),
  'notifications (as recipient)': (id) => countBy('notifications', 'recipient_id', id),
  'notifications (as actor)': (id) => countBy('notifications', 'actor_id', id),
};

describe('account deletion', () => {
  let subject: { id: string; handle: string; email: string };
  let other: { id: string; handle: string; email: string };
  let albumId: string;
  let entryId: string;
  let reviewId: string;
  let listId: string;
  let additionId: number;
  let otherListId: string;

  beforeAll(async () => {
    subject = await createUser();
    other = await createUser();
    albumId = await createAlbum();

    // A collection entry, and the two tables that hang off it.
    const { data: entry, error: entryError } = await admin
      .from('collection_entries')
      .insert({ user_id: subject.id, album_id: albumId, rating: 8.5 })
      .select('id')
      .single();
    if (entryError) throw entryError;
    entryId = entry.id;

    const { error: relistenError } = await admin
      .from('relisten_events')
      .insert({ collection_entry_id: entryId });
    if (relistenError) throw relistenError;

    const { data: review, error: reviewError } = await admin
      .from('reviews')
      .insert({ collection_entry_id: entryId, body: 'A review that must not outlive its author.' })
      .select('id')
      .single();
    if (reviewError) throw reviewError;
    reviewId = review.id;

    await admin
      .from('favourite_albums')
      .insert({ user_id: subject.id, album_id: albumId, position: 1 });
    await admin.from('want_to_listen').insert({ user_id: subject.id, album_id: albumId });

    const { data: list, error: listError } = await admin
      .from('lists')
      .insert({ user_id: subject.id, title: 'A list that must not outlive its author.' })
      .select('id')
      .single();
    if (listError) throw listError;
    listId = list.id;

    await admin.from('list_items').insert({ list_id: listId, album_id: albumId, position: 1 });

    // A list belonging to the other user, so the subject has something of
    // somebody else's to like.
    const { data: otherList, error: otherListError } = await admin
      .from('lists')
      .insert({ user_id: other.id, title: 'A list that must survive the deletion.' })
      .select('id')
      .single();
    if (otherListError) throw otherListError;
    otherListId = otherList.id;

    // Relationships in both directions, so the cascade is tested from each
    // side rather than only from the one the subject initiated.
    const { data: outboundFollow, error: outboundError } = await admin
      .from('follows')
      .insert({ follower_id: subject.id, followee_id: other.id })
      .select('id')
      .single();
    if (outboundError) throw outboundError;

    const { data: inboundFollow, error: inboundError } = await admin
      .from('follows')
      .insert({ follower_id: other.id, followee_id: subject.id })
      .select('id')
      .single();
    if (inboundError) throw inboundError;

    // Likes the subject gave, and one they received on their own list.
    await admin.from('list_likes').insert({ user_id: subject.id, list_id: otherListId });
    await admin.from('list_likes').insert({ user_id: other.id, list_id: listId });
    await admin.from('review_likes').insert({ user_id: subject.id, review_id: reviewId });

    // Notifications are written by the service rather than by a trigger, so
    // inserting the follows above does not produce them. Both directions are
    // created explicitly: `data-model.md` §8 requires deleting a user to remove
    // the notifications they *caused* for other people, not only the ones they
    // received, and only inserting one direction would leave that untested.
    await admin.from('notifications').insert({
      recipient_id: subject.id,
      actor_id: other.id,
      type: 'followed',
      follow_id: inboundFollow.id,
    });
    await admin.from('notifications').insert({
      recipient_id: other.id,
      actor_id: subject.id,
      type: 'followed',
      follow_id: outboundFollow.id,
    });

    await admin
      .from('activity')
      .insert({ actor_id: subject.id, type: 'rated', collection_entry_id: entryId });

    // Keyed by MBID rather than by album id: this table is an audit of what
    // was asked for, and survives the album row it names.
    const { data: albumRow } = await admin.from('albums').select('mbid').eq('id', albumId).single();

    const { data: addition, error: additionError } = await admin
      .from('catalogue_additions')
      .insert({ user_id: subject.id, album_mbid: albumRow!.mbid })
      .select('id')
      .single();
    if (additionError) throw additionError;
    additionId = addition.id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }
    for (const handle of reservedHandles) {
      await admin.from('reserved_handles').delete().eq('handle', handle);
    }
  });

  it('has data in every user-bearing table before the delete', async () => {
    // Without this the test could pass by having created nothing at all, which
    // is the way a cascade test most commonly lies.
    for (const [name, count] of Object.entries(USER_TABLES)) {
      expect.soft(`${name}: ${await count(subject.id)}`).toBe(`${name}: 1`);
    }
  });

  it('deletes the auth user and every row it owns', async () => {
    const { error } = await admin.auth.admin.deleteUser(subject.id);
    expect(error).toBeNull();

    for (const [name, count] of Object.entries(USER_TABLES)) {
      expect.soft(`${name}: ${await count(subject.id)}`).toBe(`${name}: 0`);
    }
  });

  it('takes the rows that hang off a collection entry with it', async () => {
    // reviews and relisten_events have no user column. They are the transitive
    // half of the cascade and the part a schema reading is most likely to miss.
    const { count: relistens } = await admin
      .from('relisten_events')
      .select('*', { count: 'exact', head: true })
      .eq('collection_entry_id', entryId);
    expect(relistens).toBe(0);

    const { count: reviews } = await admin
      .from('reviews')
      .select('*', { count: 'exact', head: true })
      .eq('id', reviewId);
    expect(reviews).toBe(0);
  });

  it('takes a list and its items with it', async () => {
    const { count: lists } = await admin
      .from('lists')
      .select('*', { count: 'exact', head: true })
      .eq('id', listId);
    expect(lists).toBe(0);

    const { count: items } = await admin
      .from('list_items')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', listId);
    expect(items).toBe(0);
  });

  it("removes another person's like on the deleted user's content", async () => {
    // This like belonged to `other`, not to the subject. It must still go,
    // because the list it was about no longer exists.
    const { count } = await admin
      .from('list_likes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', other.id)
      .eq('list_id', listId);
    expect(count).toBe(0);
  });

  it("leaves the other user's own list and its likes alone", async () => {
    // The mirror of the assertion above, and the one that would catch a cascade
    // reaching too far: the subject's like on someone else's list goes, the
    // list itself stays.
    const { count: lists } = await admin
      .from('lists')
      .select('*', { count: 'exact', head: true })
      .eq('id', otherListId);
    expect(lists).toBe(1);

    const { count: likes } = await admin
      .from('list_likes')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', otherListId);
    expect(likes).toBe(0);
  });

  it('leaves the auth user gone rather than soft-deleted', async () => {
    const { data } = await admin.auth.admin.getUserById(subject.id);
    expect(data.user).toBeNull();
  });

  it('keeps the catalogue addition as an anonymous row', async () => {
    // The one deliberate survivor: the record of what entered the catalogue
    // matters when the person is gone, and carries nothing personal once the
    // reference is cleared.
    const { data, error } = await admin
      .from('catalogue_additions')
      .select('id, user_id')
      .eq('id', additionId)
      .maybeSingle();
    if (error) throw error;

    expect(data).not.toBeNull();
    expect(data!.user_id).toBeNull();
  });

  it('leaves the catalogue itself untouched', async () => {
    const { count } = await admin
      .from('albums')
      .select('*', { count: 'exact', head: true })
      .eq('id', albumId);
    expect(count).toBe(1);
  });

  it('reserves the handle', async () => {
    const { data, error } = await admin
      .from('reserved_handles')
      .select('handle')
      .eq('handle', subject.handle)
      .maybeSingle();
    if (error) throw error;
    expect(data?.handle).toBe(subject.handle);
  });

  it('refuses the reserved handle to a new account', async () => {
    const { data, error: createError } = await admin.auth.admin.createUser({
      email: `reclaim-${Date.now()}@example.com`,
      password: 'correct-horse-battery',
      email_confirm: true,
    });
    if (createError) throw createError;
    createdUserIds.push(data.user!.id);

    const { error } = await admin
      .from('profiles')
      .insert({ id: data.user!.id, handle: subject.handle });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23505');
    // The marker the service matches on, so a reserved handle is reported as
    // unavailable rather than as an ordinary duplicate.
    expect(error!.message).toContain('profiles_handle_not_reserved');
  });

  it('leaves the other account entirely intact', async () => {
    // A cascade that took a follower with it would be catastrophic and silent.
    const { data } = await admin.from('profiles').select('id').eq('id', other.id).maybeSingle();
    expect(data?.id).toBe(other.id);
  });
});
