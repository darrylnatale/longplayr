import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * The clearing rule: creation clears Want to Listen, invocation does not.
 *
 * The distinction is the whole point of these tests. `ensure_collection_entry`
 * originally deleted the wishlist row unconditionally, so any rate, like,
 * review or relisten on an album the user **already held** destroyed a row on a
 * relation that is deliberately independent of the collection.
 *
 * Eight cases, four of each kind, one per action — because the rule lives in a
 * single function and a regression there would break all four silently.
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

const createdUserIds: string[] = [];
let albumA: string;

async function createUser() {
  const email = `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const handle = `w_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, handle });
  if (profileError) throw profileError;
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

async function ensure(client: SupabaseClient<Database>, userId: string, albumId: string) {
  const { data, error } = await client.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) throw error;
  return data!;
}

/**
 * The four implicit paths, each performed the way its service performs it:
 * ensure the entry, then write the thing that made the entry necessary.
 */
const ACTIONS = {
  async rating(client: SupabaseClient<Database>, userId: string, albumId: string) {
    const entry = await ensure(client, userId, albumId);
    await client.from('collection_entries').update({ rating: 8 }).eq('id', entry.id);
  },
  async like(client: SupabaseClient<Database>, userId: string, albumId: string) {
    const entry = await ensure(client, userId, albumId);
    await client.from('collection_entries').update({ liked: true }).eq('id', entry.id);
  },
  async review(client: SupabaseClient<Database>, userId: string, albumId: string) {
    const entry = await ensure(client, userId, albumId);
    await client.from('reviews').insert({ collection_entry_id: entry.id, body: 'Considered.' });
  },
  async relisten(client: SupabaseClient<Database>, userId: string, albumId: string) {
    const entry = await ensure(client, userId, albumId);
    await client.from('relisten_events').insert({ collection_entry_id: entry.id });
  },
} as const;

type ActionName = keyof typeof ACTIONS;
const NAMES = Object.keys(ACTIONS) as ActionName[];

async function wishlistCount(userId: string, albumId: string) {
  const { count } = await admin
    .from('want_to_listen')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('album_id', albumId);
  return count ?? 0;
}

async function entryCount(userId: string, albumId: string) {
  const { count } = await admin
    .from('collection_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('album_id', albumId);
  return count ?? 0;
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
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('creating an entry clears Want to Listen', () => {
  for (const name of NAMES) {
    it(`not collected + ${name} → entry created, wishlist cleared`, async () => {
      const user = await createUser();
      await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });
      const client = await clientFor(user.email);

      await ACTIONS[name](client, user.id, albumA);

      expect(await entryCount(user.id, albumA)).toBe(1);
      expect(await wishlistCount(user.id, albumA)).toBe(0);
    });
  }
});

describe('acting on an album already held clears nothing', () => {
  for (const name of NAMES) {
    it(`already collected + ${name} → wishlist preserved`, async () => {
      // The legal coexistence: collected first, wished second. The action does
      // not cause the entry to exist, so it must not clear the wish.
      const user = await createUser();
      const client = await clientFor(user.email);

      await ensure(client, user.id, albumA);
      await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });

      await ACTIONS[name](client, user.id, albumA);

      expect(await entryCount(user.id, albumA)).toBe(1);
      expect(await wishlistCount(user.id, albumA)).toBe(1);
    });
  }
});

describe('the rule holds at its edges', () => {
  it('clears once, on the call that creates, and not on later ones', async () => {
    const user = await createUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });
    const client = await clientFor(user.email);

    await ensure(client, user.id, albumA);
    expect(await wishlistCount(user.id, albumA)).toBe(0);

    // Wished again after collecting — a legal state that must survive.
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });
    await ensure(client, user.id, albumA);
    expect(await wishlistCount(user.id, albumA)).toBe(1);
  });

  it('still returns the same entry whether it created one or not', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);

    const first = await ensure(client, user.id, albumA);
    const second = await ensure(client, user.id, albumA);

    expect(second.id).toBe(first.id);
    expect(await entryCount(user.id, albumA)).toBe(1);
  });

  it('still never overwrites a listened_on the user set', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);

    await client.rpc('ensure_collection_entry', {
      p_user_id: user.id,
      p_album_id: albumA,
      p_listened_on: '1997-05-21',
    });
    const { data } = await client.rpc('ensure_collection_entry', {
      p_user_id: user.id,
      p_album_id: albumA,
      p_listened_on: '2020-01-01',
    });

    expect(data!.listened_on).toBe('1997-05-21');
  });

  it('stays correct under concurrent creation', async () => {
    const user = await createUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });
    const client = await clientFor(user.email);

    await Promise.all(Array.from({ length: 8 }, () => ensure(client, user.id, albumA)));

    expect(await entryCount(user.id, albumA)).toBe(1);
    expect(await wishlistCount(user.id, albumA)).toBe(0);
  });
});
