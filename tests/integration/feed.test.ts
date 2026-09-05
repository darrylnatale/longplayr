import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * The feed query, against the real database.
 *
 * **This is the layer that can prove the feed's semantics**, and most of them
 * cannot be proved anywhere else. Which events qualify, whose they are, and
 * which have stopped being true are properties of the query, so they are
 * exercised here rather than through a rendered page.
 *
 * **The RPC is called through a signed-in `authenticated` client, never through
 * the service-role one.** `feed_activity` is `security invoker`, which is what
 * makes `reviews_public_read` authoritative over whether a moderation-removed
 * review is visible. A service-role client bypasses RLS entirely and would pass
 * every assertion below while proving nothing about the property that matters.
 *
 * The services build a cookie-bound client and cannot be called without a
 * request scope, so the writes here **issue the statements the services issue**.
 * Where that matters the replication is exact and says so.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 20_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

async function createUser(): Promise<{ id: string; email: string; handle: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `feed-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);
  const handle = `f_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;
  return { id, email, handle };
}

/** A client carrying a real session, so RLS applies as it does in the app. */
async function signedInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** `ensureEntry`'s statement — the creation path shared by every caller. */
async function ensureEntry(userId: string, albumId: string) {
  const { data, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) throw error;
  return data as Database['public']['Tables']['collection_entries']['Row'];
}

/** `addToCollection`'s two statements: create the entry, then record the event. */
async function addToCollection(userId: string, albumId: string) {
  const entry = await ensureEntry(userId, albumId);
  const { error } = await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'listened', collection_entry_id: entry.id });
  if (error && error.code !== '23505') throw error;
  return entry;
}

/** `rateAlbum`'s statements: ensure, update the rating, record the event. */
async function rateAlbum(userId: string, albumId: string, rating: number) {
  const entry = await ensureEntry(userId, albumId);
  const { error: updateError } = await admin
    .from('collection_entries')
    .update({ rating })
    .eq('id', entry.id);
  if (updateError) throw updateError;

  const { error } = await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'rated', collection_entry_id: entry.id });
  if (error && error.code !== '23505') throw error;
  return entry;
}

/** `markRelisten`'s statements: ensure, insert the relisten, record the event. */
async function markRelisten(userId: string, albumId: string) {
  const entry = await ensureEntry(userId, albumId);
  const { data: relisten, error: relistenError } = await admin
    .from('relisten_events')
    .insert({ collection_entry_id: entry.id })
    .select()
    .single();
  if (relistenError) throw relistenError;

  const { error } = await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'relistened', relisten_event_id: relisten.id });
  if (error) throw error;
  return relisten;
}

/** `saveReview`'s statements: ensure, upsert the review, record the event. */
async function saveReview(userId: string, albumId: string, body: string) {
  const entry = await ensureEntry(userId, albumId);
  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({ collection_entry_id: entry.id, body })
    .select()
    .single();
  if (reviewError) throw reviewError;

  const { error } = await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'reviewed', review_id: review.id });
  if (error && error.code !== '23505') throw error;
  return review;
}

async function follow(followerId: string, followeeId: string) {
  const { error } = await admin
    .from('follows')
    .insert({ follower_id: followerId, followee_id: followeeId });
  if (error) throw error;
}

/** `createList`'s two statements: insert the list, then record the event. */
async function createList(
  userId: string,
  title: string,
  status: 'live' | 'removed' = 'live',
): Promise<string> {
  const { data, error } = await admin
    .from('lists')
    .insert({ user_id: userId, title, status })
    .select('id')
    .single();
  if (error) throw error;

  const { error: eventError } = await admin
    .from('activity')
    .insert({ actor_id: userId, type: 'list_created', list_id: data.id });
  if (eventError) throw eventError;

  return data.id;
}

type FeedRow = Database['public']['Functions']['feed_activity']['Returns'][number];

async function feedFor(
  client: SupabaseClient<Database>,
  viewerId: string,
  options: { limit?: number; before?: string; beforeId?: string } = {},
): Promise<FeedRow[]> {
  const { data, error } = await client.rpc('feed_activity', {
    p_viewer: viewerId,
    p_limit: options.limit ?? 20,
    p_before: options.before,
    p_before_id: options.beforeId,
  });
  if (error) throw error;
  return data ?? [];
}

beforeEach(async () => {
  await admin.from('activity').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('follows').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

beforeEach(async () => {
  if (albumA) return;
  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);
  const { data } = await admin.from('albums').select('id, mbid').order('mbid');
  albumA = data![0].id;
  albumB = data![1].id;
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('what the feed contains', () => {
  it('returns all five event types from a followed account', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    await addToCollection(actor.id, albumA);
    await rateAlbum(actor.id, albumB, 9.6);
    await markRelisten(actor.id, albumA);
    await saveReview(actor.id, albumB, 'A considered paragraph about this record.');
    await createList(actor.id, 'Long drive records');

    const client = await signedInAs(viewer.email);
    const rows = await feedFor(client, viewer.id);

    expect(rows.map((r) => r.type).sort()).toEqual([
      'list_created',
      'listened',
      'rated',
      'relistened',
      'reviewed',
    ]);
  });

  /**
   * **The album path had to become a LEFT join for list events to survive, so
   * this asserts both halves of that change.** A list row carries its list and
   * no album; an album row is unchanged and still carries no list.
   */
  it('carries list-shaped data, and leaves album rows album-shaped', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    const listId = await createList(actor.id, 'A named list');
    await rateAlbum(actor.id, albumA, 7.5);

    const client = await signedInAs(viewer.email);
    const rows = await feedFor(client, viewer.id);

    const list = rows.find((r) => r.type === 'list_created')!;
    expect(list.list_id).toBe(listId);
    expect(list.list_title).toBe('A named list');
    expect(list.album_mbid).toBeNull();

    const rated = rows.find((r) => r.type === 'rated')!;
    expect(rated.album_mbid).toBeTruthy();
    expect(rated.list_id).toBeNull();
  });

  it('carries the joined payload in one call, with no second query', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    await rateAlbum(actor.id, albumA, 0.0);

    const client = await signedInAs(viewer.email);
    const [row] = await feedFor(client, viewer.id);

    expect(row.actor_handle).toBe(actor.handle);
    expect(row.album_title).toBeTruthy();
    expect(row.album_credit).toBeTruthy();
    expect(row.album_mbid).toBeTruthy();
    expect(row.album_artwork_status).toBeTruthy();
    // A real 0.0 is a score, not an absence. The mapper has the same trap.
    expect(Number(row.rating)).toBe(0);
  });

  it('orders newest first', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    await addToCollection(actor.id, albumA);
    await markRelisten(actor.id, albumB);

    const client = await signedInAs(viewer.email);
    const rows = await feedFor(client, viewer.id);
    const times = rows.map((r) => Date.parse(r.created_at));

    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('whose events appear', () => {
  it('excludes an account the viewer does not follow', async () => {
    const viewer = await createUser();
    const stranger = await createUser();
    await addToCollection(stranger.id, albumA);

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id)).toHaveLength(0);
  });

  /**
   * **The viewer's own events are excluded by the follow graph itself.**
   * `follows_no_self_follow` makes a self-follow impossible, so the query needs
   * no separate predicate. That is an emergent property rather than a written
   * rule, which is exactly why it is pinned here.
   */
  it("excludes the viewer's own activity, with no predicate doing it", async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    await addToCollection(viewer.id, albumA);
    await addToCollection(actor.id, albumB);

    const client = await signedInAs(viewer.email);
    const rows = await feedFor(client, viewer.id);

    expect(rows).toHaveLength(1);
    expect(rows[0].actor_handle).toBe(actor.handle);
  });

  it('excludes a followed account that has been suspended', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    await addToCollection(actor.id, albumA);

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id)).toHaveLength(1);

    await admin.from('profiles').update({ status: 'suspended' }).eq('id', actor.id);

    expect(await feedFor(client, viewer.id)).toHaveLength(0);
  });
});

describe('events whose subject no longer supports them', () => {
  it('drops a rated event once the rating is cleared', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    const entry = await rateAlbum(actor.id, albumA, 7.5);

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id)).toHaveLength(1);

    // The state the non-atomic rating write can leave behind: the entry survives
    // with a null rating while its event does not. The feed tolerates it; it
    // does not fix it.
    await admin.from('collection_entries').update({ rating: null }).eq('id', entry.id);

    expect(await feedFor(client, viewer.id)).toHaveLength(0);
  });

  /**
   * **The property that requires `security invoker`.** A service-role client
   * would return this row and the assertion would pass for the wrong reason.
   */
  it('drops a reviewed event once the review is moderation-removed', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    const review = await saveReview(actor.id, albumA, 'Worth reading, until it is not.');

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id)).toHaveLength(1);

    await admin.from('reviews').update({ status: 'removed' }).eq('id', review.id);

    expect(await feedFor(client, viewer.id)).toHaveLength(0);
  });

  it('keeps a live review visible to a viewer who is not its author', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    await saveReview(actor.id, albumA, 'Still live, still readable.');

    const client = await signedInAs(viewer.email);
    const rows = await feedFor(client, viewer.id);

    expect(rows).toHaveLength(1);
    expect(rows[0].review_body).toContain('Still live');
  });

  it('drops every event of a removed album by cascade', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    const entry = await addToCollection(actor.id, albumA);

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id)).toHaveLength(1);

    await admin.from('collection_entries').delete().eq('id', entry.id);

    expect(await feedFor(client, viewer.id)).toHaveLength(0);
  });
});

describe('keyset pagination', () => {
  it('never repeats the cursor row', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    await addToCollection(actor.id, albumA);
    await markRelisten(actor.id, albumA);
    await markRelisten(actor.id, albumB);

    const client = await signedInAs(viewer.email);
    const first = await feedFor(client, viewer.id, { limit: 2 });
    expect(first).toHaveLength(2);

    const last = first[1];
    const second = await feedFor(client, viewer.id, {
      limit: 2,
      before: last.created_at,
      beforeId: last.id,
    });

    expect(second).toHaveLength(1);
    expect(second.map((r) => r.id)).not.toContain(last.id);
    expect(first.map((r) => r.id)).not.toContain(second[0].id);
  });

  /**
   * Three events written in one instant. The timestamp alone cannot separate
   * them, so `id` is what makes the ordering total — without it a page boundary
   * landing inside the group would drop or repeat rows.
   */
  it('pages deterministically when timestamps collide', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    const entry = await ensureEntry(actor.id, albumA);
    const shared = new Date().toISOString();
    const relistens = [];
    for (let i = 0; i < 3; i++) {
      const { data } = await admin
        .from('relisten_events')
        .insert({ collection_entry_id: entry.id })
        .select()
        .single();
      relistens.push(data!.id);
    }
    const { error } = await admin.from('activity').insert(
      relistens.map((id) => ({
        actor_id: actor.id,
        type: 'relistened' as const,
        relisten_event_id: id,
        created_at: shared,
      })),
    );
    if (error) throw error;

    const client = await signedInAs(viewer.email);
    const all = await feedFor(client, viewer.id, { limit: 10 });
    expect(all).toHaveLength(3);

    const page1 = await feedFor(client, viewer.id, { limit: 2 });
    const page2 = await feedFor(client, viewer.id, {
      limit: 2,
      before: page1[1].created_at,
      beforeId: page1[1].id,
    });

    expect([...page1, ...page2].map((r) => r.id)).toEqual(all.map((r) => r.id));
  });

  it('respects the limit', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    await addToCollection(actor.id, albumA);
    await markRelisten(actor.id, albumA);
    await markRelisten(actor.id, albumB);

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id, { limit: 1 })).toHaveLength(1);
  });
});

describe('the anti-flood invariant, read from the feed', () => {
  /**
   * The write-path half is proved in `activity.test.ts`. This is the half that
   * matters to a follower: a bulk backfill by someone they follow puts nothing
   * in front of them.
   */
  it('shows nothing for forty entries created through the silent path', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    for (let i = 0; i < 40; i++) {
      await ensureEntry(actor.id, i % 2 === 0 ? albumA : albumB);
    }

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id)).toHaveLength(0);
  });
});

describe('list events and what they depend on', () => {
  it('omits a list the viewer may not read', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    await createList(actor.id, 'Moderated away', 'removed');

    const client = await signedInAs(viewer.email);

    expect(await feedFor(client, viewer.id)).toEqual([]);
  });

  it('keeps the same list visible to its owner, which is what proves RLS did it', async () => {
    const actor = await createUser();
    const viewer = await createUser();
    await follow(viewer.id, actor.id);
    await createList(actor.id, 'Moderated away', 'removed');

    // The owner follows nobody, so this reads their own row directly rather
    // than through the feed — the point is that the list still exists and is
    // readable by them, so the feed's omission above is RLS and not deletion.
    const ownerClient = await signedInAs(actor.email);
    const { data } = await ownerClient.from('lists').select('id').eq('user_id', actor.id);

    expect(data).toHaveLength(1);
  });

  it('drops the event when the list is deleted', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);
    const listId = await createList(actor.id, 'Deleted later');

    const client = await signedInAs(viewer.email);
    expect(await feedFor(client, viewer.id)).toHaveLength(1);

    await admin.from('lists').delete().eq('id', listId);

    expect(await feedFor(client, viewer.id)).toEqual([]);
  });

  it('pages deterministically when album and list events share a timestamp', async () => {
    const viewer = await createUser();
    const actor = await createUser();
    await follow(viewer.id, actor.id);

    await addToCollection(actor.id, albumA);
    await createList(actor.id, 'Same instant one');
    await rateAlbum(actor.id, albumB, 4.2);
    await createList(actor.id, 'Same instant two');

    const stamp = new Date().toISOString();
    await admin.from('activity').update({ created_at: stamp }).eq('actor_id', actor.id);

    const client = await signedInAs(viewer.email);
    const first = await feedFor(client, viewer.id, { limit: 2 });
    const last = first[first.length - 1];
    const second = await feedFor(client, viewer.id, {
      limit: 2,
      before: last.created_at,
      beforeId: last.id,
    });

    const ids = [...first, ...second].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });
});
