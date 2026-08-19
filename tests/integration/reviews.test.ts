import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Review invariants, at the database contract.
 *
 * The service itself builds a cookie-bound client and cannot be called without
 * a request scope, so these exercise the same statements it issues — the same
 * convention every other suite here follows.
 *
 * Two of these pin decisions rather than behaviour, and both could be broken by
 * a change that looks like a simplification:
 *
 *  - editing preserves `id` and `created_at`, because Phase 3 will reference
 *    the review id from likes, notifications and reports;
 *  - deleting a review never creates a collection entry, which it used to.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

/**
 * Auth-heavy: this file creates real users through GoTrue and signs in as them.
 *
 * Those calls are fast in the median — around 100ms — but have a long tail:
 * measured over 2,369 requests, 0.4% exceed a second and the worst observed was
 * 4.2s. A test making half a dozen of them can therefore blow Vitest's 5s
 * default through no fault of its own, which is exactly what happened to three
 * rating tests that passed in isolation seconds later.
 *
 * 15s covers the p99 across those calls plus one worst-case outlier, with room
 * to spare. It is set here rather than on the whole project so the tests that
 * never touch auth keep the tight budget — those are the ones that would notice
 * a query getting slower.
 */
vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASSWORD = 'correct-horse-battery';

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
let albumA: string;

async function createUser(handlePrefix = 'rv') {
  const email = `rv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const handle = `${handlePrefix}_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: data.user.id, handle, display_name: 'A Listener' });
  if (profileError) throw profileError;
  return { id: data.user.id, email, handle };
}

async function clientFor(email: string) {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function ensure(client: SupabaseClient<Database>, userId: string, albumId: string) {
  const { data, error } = await client.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) throw error;
  return data!;
}

/** Save, exactly as the service does: ensure the entry, then upsert the body. */
async function saveReview(
  client: SupabaseClient<Database>,
  userId: string,
  albumId: string,
  body: string,
) {
  const entry = await ensure(client, userId, albumId);
  return client
    .from('reviews')
    .upsert({ collection_entry_id: entry.id, body }, { onConflict: 'collection_entry_id' })
    .select()
    .single();
}

/**
 * Delete, exactly as the corrected service does: look the entry up, and do
 * nothing when there isn't one. Notably it does **not** ensure the entry.
 */
async function deleteReview(client: SupabaseClient<Database>, userId: string, albumId: string) {
  const { data: entry } = await client
    .from('collection_entries')
    .select('id')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .maybeSingle();
  if (!entry) return { skipped: true as const };
  await client.from('reviews').delete().eq('collection_entry_id', entry.id);
  return { skipped: false as const };
}

beforeAll(() => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing. Run `npm run db:env`.');
});

beforeEach(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);
  const { data } = await admin.from('albums').select('id').order('title');
  albumA = data![0].id;
});

afterAll(async () => {
  // Deleted concurrently. Sequentially this was one round-trip per user — 40
  // to 70 of them in the larger files, at roughly 100ms each, which put the
  // hook within a second or two of Vitest's 5s default before anything went
  // wrong. Each delete targets a distinct user, so there is no ordering between
  // them and nothing to serialise.
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('editing preserves review identity', () => {
  it('keeps id and created_at when the body changes', async () => {
    // Load-bearing for Phase 3: likes, notifications and reports will all
    // reference the review id. A delete-and-insert would look identical to a
    // user and orphan every one of them.
    const user = await createUser();
    const client = await clientFor(user.email);

    const { data: first } = await saveReview(client, user.id, albumA, 'First thoughts.');
    await new Promise((r) => setTimeout(r, 50));
    const { data: second } = await saveReview(client, user.id, albumA, 'Revised thoughts.');

    expect(second!.id).toBe(first!.id);
    expect(second!.created_at).toBe(first!.created_at);
    expect(second!.body).toBe('Revised thoughts.');
  });

  it('moves updated_at while created_at stands still', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    const { data: first } = await saveReview(client, user.id, albumA, 'One.');
    await new Promise((r) => setTimeout(r, 50));
    const { data: second } = await saveReview(client, user.id, albumA, 'Two.');

    expect(new Date(second!.updated_at).getTime()).toBeGreaterThan(
      new Date(first!.updated_at).getTime(),
    );
    expect(second!.created_at).toBe(first!.created_at);
  });

  it('never produces a second review row for one album', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await saveReview(client, user.id, albumA, 'One.');
    await saveReview(client, user.id, albumA, 'Two.');
    await saveReview(client, user.id, albumA, 'Three.');

    const entry = await ensure(client, user.id, albumA);
    const { count } = await admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('collection_entry_id', entry.id);
    expect(count).toBe(1);
  });
});

describe('deleting a review', () => {
  it('never creates a collection entry when the album is not collected', async () => {
    // The regression. This used to run through ensureEntry, so deleting a
    // review you did not have collected an album you did not hold.
    const user = await createUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });
    const client = await clientFor(user.email);

    const result = await deleteReview(client, user.id, albumA);
    expect(result.skipped).toBe(true);

    const { count: entries } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(entries).toBe(0);

    const { count: wishes } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    expect(wishes).toBe(1);
  });

  it('is a hard delete, not a status change', async () => {
    // Decision A: `removed` is a moderation state, not how an author removes
    // their own writing.
    const user = await createUser();
    const client = await clientFor(user.email);
    await saveReview(client, user.id, albumA, 'Considered.');

    await deleteReview(client, user.id, albumA);

    const entry = await ensure(client, user.id, albumA);
    const { count } = await admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('collection_entry_id', entry.id);
    expect(count).toBe(0);
  });

  it('leaves the collection entry intact', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await saveReview(client, user.id, albumA, 'Considered.');
    await deleteReview(client, user.id, albumA);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    expect(count).toBe(1);
  });
});

describe('reviews carry their author', () => {
  it('returns handle, display name and the author’s own score', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    const entry = await ensure(client, user.id, albumA);
    await client.from('collection_entries').update({ rating: 8.5 }).eq('id', entry.id);
    await client.from('reviews').insert({ collection_entry_id: entry.id, body: 'Considered.' });

    const { data, error } = await anon
      .from('reviews')
      .select(
        `id, body, created_at, updated_at, collection_entries!inner(album_id, rating, profiles!inner(id, handle, display_name, avatar_url))`,
      )
      .eq('collection_entries.album_id', albumA)
      .eq('status', 'live')
      .order('created_at', { ascending: false });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const entryRow = data![0].collection_entries as unknown as {
      rating: number | null;
      profiles: { id: string; handle: string; display_name: string | null };
    };
    expect(entryRow.profiles.handle).toBe(user.handle);
    expect(entryRow.profiles.display_name).toBe('A Listener');
    expect(entryRow.profiles.id).toBe(user.id);
    expect(Number(entryRow.rating)).toBe(8.5);
  });

  it('excludes removed reviews from the public read', async () => {
    // Moderation visibility is unchanged by carrying the author.
    const user = await createUser();
    const client = await clientFor(user.email);
    const entry = await ensure(client, user.id, albumA);
    await client.from('reviews').insert({ collection_entry_id: entry.id, body: 'Considered.' });
    await admin.from('reviews').update({ status: 'removed' }).eq('collection_entry_id', entry.id);

    const { data } = await anon
      .from('reviews')
      .select(`id, collection_entries!inner(album_id)`)
      .eq('collection_entries.album_id', albumA)
      .eq('status', 'live');

    expect(data).toHaveLength(0);
  });

  it('lets a removed review stay readable to its own author', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    const entry = await ensure(client, user.id, albumA);
    await client.from('reviews').insert({ collection_entry_id: entry.id, body: 'Considered.' });
    await admin.from('reviews').update({ status: 'removed' }).eq('collection_entry_id', entry.id);

    // Read back through the author's own client: the RLS policy lets them see
    // it, so moderation never makes someone's writing vanish without a trace.
    const { data: mine } = await client
      .from('reviews')
      .select('id, status')
      .eq('collection_entry_id', entry.id);

    expect(mine).toHaveLength(1);
    expect(mine![0].status).toBe('removed');
  });
});
