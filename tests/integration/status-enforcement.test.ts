import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * What a suspended account stops being able to show you
 * (`architecture.md` §16.9).
 *
 * **Enumerated rather than sampled, and that is the whole deliverable.**
 * `product-spec.md` §4 has carried status columns since Phase 0, but no rule
 * said which reads must consult them — so each call site decided alone and
 * three decided wrong. A test that checks "some surfaces" would have passed
 * before this cycle too.
 *
 * **Every surface here is asserted in both directions.** Showing that a
 * suspended user's rating is absent proves nothing unless the same query
 * returned it while they were active — that is how a filter that excludes
 * everything passes for a working one.
 *
 * **The services cannot be called from here**, since they build a cookie-bound
 * client and there is no request scope. These issue the same statements the
 * services issue, and the replication is exact where it matters — the `!inner`
 * embeds in particular, which are what make a status predicate drop a row
 * rather than null a join.
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
let subject = { id: '', handle: '' };
let bystander = { id: '', handle: '' };
let albumId = '';
let listId = '';
/** Owned by the subject, so suspension must take its public page with it. */
let subjectListId = '';

async function createUser(prefix: string): Promise<{ id: string; handle: string }> {
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

async function setStatus(userId: string, status: Database['public']['Enums']['user_status']) {
  const { error } = await admin.from('profiles').update({ status }).eq('id', userId);
  if (error) throw error;
}

/** `getAlbumRating`, replicated exactly — including the `!inner` embed. */
async function albumRating(): Promise<{ count: number; mean: number | null }> {
  const { data, error } = await admin
    .from('collection_entries')
    .select('rating, person:profiles!inner(status)')
    .eq('album_id', albumId)
    .eq('person.status', 'active')
    .not('rating', 'is', null);
  if (error) throw error;

  const ratings = (data ?? []).map((row) => Number(row.rating));
  if (ratings.length === 0) return { count: 0, mean: null };
  return { count: ratings.length, mean: ratings.reduce((a, b) => a + b, 0) / ratings.length };
}

/** `getAlbumReviews`, replicated exactly. */
async function albumReviewHandles(): Promise<string[]> {
  const { data, error } = await admin
    .from('reviews')
    .select(`id, collection_entries!inner(album_id, profiles!inner(handle, status))`)
    .eq('collection_entries.album_id', albumId)
    .eq('status', 'live')
    .eq('collection_entries.profiles.status', 'active');
  if (error) throw error;

  return (data ?? []).map(
    (row) =>
      (row.collection_entries as unknown as { profiles: { handle: string } }).profiles.handle,
  );
}

/** `listLikeCount`, replicated exactly. */
async function listLikes(): Promise<number> {
  const { count, error } = await admin
    .from('list_likes')
    .select('id, person:profiles!inner(status)', { count: 'exact', head: true })
    .eq('list_id', listId)
    .eq('person.status', 'active');
  if (error) throw error;
  return count ?? 0;
}

/** `getList`, replicated exactly — the author-status filter in particular. */
async function listIsReadable(id: string): Promise<boolean> {
  const { data, error } = await admin
    .from('lists')
    .select(`id, profiles!lists_user_id_fkey!inner(handle, status)`)
    .eq('id', id)
    .eq('profiles.status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** `getFollowCounts`' follower side, replicated exactly. Already correct. */
async function followerCount(): Promise<number> {
  const { count, error } = await admin
    .from('follows')
    .select('id, person:profiles!follows_follower_id_fkey!inner(status)', {
      count: 'exact',
      head: true,
    })
    .eq('followee_id', bystander.id)
    .eq('person.status', 'active');
  if (error) throw error;
  return count ?? 0;
}

/** The feed, which filters in SQL rather than in a query builder. */
async function feedActorHandles(): Promise<string[]> {
  const { data, error } = await admin.rpc('feed_activity', {
    p_viewer: bystander.id,
    p_limit: 50,
  });
  if (error) throw error;
  return (data ?? []).map((row) => row.actor_handle);
}

beforeAll(async () => {
  subject = await createUser('susp');
  bystander = await createUser('byst');

  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const { data: album, error: albumError } = await admin
    .from('albums')
    .insert({
      mbid: crypto.randomUUID(),
      title: `Status Enforcement ${stamp}`,
      display_credit: 'Someone',
      primary_type: 'album',
    })
    .select('id')
    .single();
  if (albumError) throw albumError;
  albumId = album.id;

  const { data: entry, error: entryError } = await admin
    .from('collection_entries')
    .insert({ user_id: subject.id, album_id: albumId, rating: 10 })
    .select('id')
    .single();
  if (entryError) throw entryError;

  const { error: reviewError } = await admin.from('reviews').insert({
    collection_entry_id: entry.id,
    body: 'A review by an account about to be suspended.',
  });
  if (reviewError) throw reviewError;

  // The bystander owns the list; the subject likes it, so the like is what the
  // suspension must remove rather than the list itself.
  const { data: list, error: listError } = await admin
    .from('lists')
    .insert({ user_id: bystander.id, title: `Status Enforcement List ${stamp}` })
    .select('id')
    .single();
  if (listError) throw listError;
  listId = list.id;

  await admin.from('list_likes').insert({ user_id: subject.id, list_id: listId });

  const { data: ownList, error: ownListError } = await admin
    .from('lists')
    .insert({ user_id: subject.id, title: `Subject's Own List ${stamp}` })
    .select('id')
    .single();
  if (ownListError) throw ownListError;
  subjectListId = ownList.id;

  // **Both directions, because the two assertions need opposite edges.** The
  // follower count asks whether a suspended account stops counting as somebody
  // else's follower, so the subject must follow the bystander. The feed asks
  // whether their activity leaves a follower's timeline, and `feed_activity`
  // shows only people the *viewer* follows — so the bystander must follow the
  // subject as well. A single edge satisfies one assertion and silently empties
  // the other, which is exactly what it did.
  await admin.from('follows').insert({ follower_id: subject.id, followee_id: bystander.id });
  await admin.from('follows').insert({ follower_id: bystander.id, followee_id: subject.id });
  await admin
    .from('activity')
    .insert({ actor_id: subject.id, type: 'rated', collection_entry_id: entry.id });
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
  await admin.from('albums').delete().eq('id', albumId);
});

describe('while the account is active', () => {
  // Without these the suspension assertions prove nothing: a filter that
  // excludes everything looks identical to one that works.
  it('counts their rating in the album average', async () => {
    const rating = await albumRating();
    expect(rating.count).toBe(1);
    expect(rating.mean).toBe(10);
  });

  it('shows their review on the album page', async () => {
    expect(await albumReviewHandles()).toContain(subject.handle);
  });

  it('counts their like on a list', async () => {
    expect(await listLikes()).toBe(1);
  });

  it('counts them as a follower', async () => {
    expect(await followerCount()).toBe(1);
  });

  it('shows their activity in a follower’s feed', async () => {
    expect(await feedActorHandles()).toContain(subject.handle);
  });

  it('serves the public page of a list they own', async () => {
    expect(await listIsReadable(subjectListId)).toBe(true);
  });
});

describe('once the account is suspended', () => {
  beforeAll(() => setStatus(subject.id, 'suspended'));

  it('drops their rating out of the album average', async () => {
    // The gap that mattered most: rating with a throwaway account is the
    // behaviour a ban exists to undo, and it did not undo it.
    const rating = await albumRating();
    expect(rating.count).toBe(0);
    expect(rating.mean).toBeNull();
  });

  it('takes their review off the album page', async () => {
    expect(await albumReviewHandles()).not.toContain(subject.handle);
  });

  it('stops counting their like', async () => {
    expect(await listLikes()).toBe(0);
  });

  it('stops counting them as a follower', async () => {
    expect(await followerCount()).toBe(0);
  });

  it('removes their activity from the feed', async () => {
    expect(await feedActorHandles()).not.toContain(subject.handle);
  });

  it('stops serving the public page of a list they own', async () => {
    // A removed list was already hidden by RLS, but a *live* list by a
    // suspended author stayed publicly readable while every one of that
    // author's profile routes returned 404.
    expect(await listIsReadable(subjectListId)).toBe(false);
  });

  it('leaves the list they liked untouched', async () => {
    // A suspension hides what the account did, never what other people own.
    const { data } = await admin.from('lists').select('id').eq('id', listId).maybeSingle();
    expect(data?.id).toBe(listId);
  });
});

describe('a banned account is hidden exactly as a suspended one is', () => {
  // The two differ in what the account may still *do*, which belongs to the
  // slice that builds the actions. Every read path treats them alike.
  beforeAll(() => setStatus(subject.id, 'banned'));

  it('hides the same things', async () => {
    expect((await albumRating()).count).toBe(0);
    expect(await albumReviewHandles()).not.toContain(subject.handle);
    expect(await listLikes()).toBe(0);
    expect(await followerCount()).toBe(0);
    expect(await feedActorHandles()).not.toContain(subject.handle);
    expect(await listIsReadable(subjectListId)).toBe(false);
  });
});

describe('reinstating the account restores everything', () => {
  beforeAll(() => setStatus(subject.id, 'active'));

  it('brings back the rating, the review, the like, the follow and the feed item', async () => {
    // Suspension hides; it does not destroy. Deletion is the destructive one,
    // and it is a different mechanism with its own test.
    expect((await albumRating()).count).toBe(1);
    expect(await albumReviewHandles()).toContain(subject.handle);
    expect(await listLikes()).toBe(1);
    expect(await followerCount()).toBe(1);
    expect(await feedActorHandles()).toContain(subject.handle);
    expect(await listIsReadable(subjectListId)).toBe(true);
  });
});
