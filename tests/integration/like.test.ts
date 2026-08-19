import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Liking, at the database contract.
 *
 * Exercises the path the service uses — `ensure_collection_entry` to create,
 * then an owner-scoped update — because the service itself builds a
 * cookie-bound client and there is no request scope in a test.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

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
let albumB: string;

async function createUser(withProfile = true) {
  const email = `like-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  if (withProfile) {
    const handle = `l_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
    const { error: profileError } = await admin
      .from('profiles')
      .insert({ id: data.user.id, handle });
    if (profileError) throw profileError;
  }
  return { id: data.user.id, email };
}

async function clientFor(email: string) {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** Set the like, exactly as the service does: ensure the entry, then update. */
async function setLike(
  client: SupabaseClient<Database>,
  userId: string,
  albumId: string,
  liked: boolean,
) {
  const { data: entry, error } = await client.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) return { error };
  return client.from('collection_entries').update({ liked }).eq('id', entry!.id);
}

async function entryOf(userId: string, albumId: string) {
  const { data } = await admin
    .from('collection_entries')
    .select('liked, rating')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .maybeSingle();
  return data;
}

async function countEntries(userId: string) {
  const { count } = await admin
    .from('collection_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count;
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
  albumB = data![1].id;
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('liking', () => {
  it('lets an authenticated user like an album', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);

    const { error } = await setLike(client, user.id, albumA, true);
    expect(error).toBeFalsy();
    expect((await entryOf(user.id, albumA))!.liked).toBe(true);
  });

  it('lets the same user unlike it again', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await setLike(client, user.id, albumA, true);
    await setLike(client, user.id, albumA, false);

    expect((await entryOf(user.id, albumA))!.liked).toBe(false);
    // Unliking is not leaving the collection.
    expect(await countEntries(user.id)).toBe(1);
  });

  it('creates exactly one collection entry when liking an uncollected album', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await setLike(client, user.id, albumA, true);

    expect(await countEntries(user.id)).toBe(1);
    const entry = await entryOf(user.id, albumA);
    expect(entry!.liked).toBe(true);
    // The implicit add claims nothing about a score.
    expect(entry!.rating).toBeNull();
  });

  it('clears Want to Listen when it collects implicitly', async () => {
    const user = await createUser();
    await admin.from('want_to_listen').insert([
      { user_id: user.id, album_id: albumA },
      { user_id: user.id, album_id: albumB },
    ]);

    const client = await clientFor(user.email);
    await setLike(client, user.id, albumA, true);

    const { data } = await admin.from('want_to_listen').select('album_id').eq('user_id', user.id);
    expect(data).toHaveLength(1);
    expect(data![0].album_id).toBe(albumB);
  });

  it('stays idempotent when the same value is submitted repeatedly', async () => {
    // The desired next value is submitted rather than derived, so a resubmitted
    // form settles on one state instead of toggling.
    const user = await createUser();
    const client = await clientFor(user.email);

    await Promise.all([
      setLike(client, user.id, albumA, true),
      setLike(client, user.id, albumA, true),
      setLike(client, user.id, albumA, true),
    ]);

    expect(await countEntries(user.id)).toBe(1);
    expect((await entryOf(user.id, albumA))!.liked).toBe(true);
  });

  it('writes no activity, because activity does not exist yet', async () => {
    const user = await createUser();
    await setLike(await clientFor(user.email), user.id, albumA, true);
    const { error } = await admin.from('activity' as never).select('id');
    expect(error).not.toBeNull();
  });
});

describe('like is independent of rating', () => {
  it('leaves a liked album unrated', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await setLike(client, user.id, albumA, true);

    const entry = await entryOf(user.id, albumA);
    expect(entry!.liked).toBe(true);
    expect(entry!.rating).toBeNull();
  });

  it('keeps the rating when the like is toggled', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await client.rpc('ensure_collection_entry', { p_user_id: user.id, p_album_id: albumA });
    await client
      .from('collection_entries')
      .update({ rating: 7.5 })
      .eq('user_id', user.id)
      .eq('album_id', albumA);

    await setLike(client, user.id, albumA, true);
    expect(Number((await entryOf(user.id, albumA))!.rating)).toBe(7.5);

    await setLike(client, user.id, albumA, false);
    expect(Number((await entryOf(user.id, albumA))!.rating)).toBe(7.5);
  });

  it('keeps the like when the rating is cleared', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await setLike(client, user.id, albumA, true);
    await client
      .from('collection_entries')
      .update({ rating: 9 })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    await client
      .from('collection_entries')
      .update({ rating: null })
      .eq('user_id', user.id)
      .eq('album_id', albumA);

    const entry = await entryOf(user.id, albumA);
    expect(entry!.rating).toBeNull();
    expect(entry!.liked).toBe(true);
  });
});

describe('authorisation', () => {
  it('refuses a signed-out caller', async () => {
    const user = await createUser();
    const { error } = await setLike(anon, user.id, albumA, true);
    expect(error).not.toBeNull();
    expect(await countEntries(user.id)).toBe(0);
  });

  it('refuses a user without a completed profile', async () => {
    const user = await createUser(false);
    const client = await clientFor(user.email);

    const { error } = await setLike(client, user.id, albumA, true);
    expect(error).not.toBeNull();
    expect(await countEntries(user.id)).toBe(0);
  });

  it('does not let one user change another’s like', async () => {
    const owner = await createUser();
    const intruder = await createUser();
    await setLike(await clientFor(owner.email), owner.id, albumA, true);

    const intruderClient = await clientFor(intruder.email);
    await intruderClient
      .from('collection_entries')
      .update({ liked: false })
      .eq('user_id', owner.id)
      .eq('album_id', albumA);

    expect((await entryOf(owner.id, albumA))!.liked).toBe(true);
  });

  it('keeps two users’ likes on one album independent', async () => {
    const one = await createUser();
    const two = await createUser();
    await setLike(await clientFor(one.email), one.id, albumA, true);
    await setLike(await clientFor(two.email), two.id, albumA, false);

    expect((await entryOf(one.id, albumA))!.liked).toBe(true);
    expect((await entryOf(two.id, albumA))!.liked).toBe(false);
  });
});
