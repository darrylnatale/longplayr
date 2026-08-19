import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Add and remove, as the album page performs them.
 *
 * The service layer cannot be called here — it builds a cookie-bound client and
 * there is no request scope in a test — so these exercise the same path the
 * service uses: `ensure_collection_entry` for creation, a scoped delete for
 * removal, and a real signed-in client for the authorisation cases.
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

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

const PASSWORD = 'correct-horse-battery';

async function createUser() {
  const email = `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user;
}

async function createProfiledUser() {
  const user = await createUser();
  const handle = `a_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error } = await admin.from('profiles').insert({ id: user.id, handle });
  if (error) throw error;
  return user;
}

/** A client authenticated as a real user, so RLS applies as it would in the app. */
async function clientFor(email: string) {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function emailOf(userId: string) {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data.user!.email!;
}

/** The canonical add, exactly as the service performs it. */
async function add(client: SupabaseClient<Database>, userId: string, albumId: string) {
  return client.rpc('ensure_collection_entry', { p_user_id: userId, p_album_id: albumId });
}

/** The canonical remove, scoped to the owner as the service scopes it. */
async function remove(client: SupabaseClient<Database>, userId: string, albumId: string) {
  return client.from('collection_entries').delete().eq('user_id', userId).eq('album_id', albumId);
}

beforeAll(async () => {
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
  // Deleted concurrently. Sequentially this was one round-trip per user — 40
  // to 70 of them in the larger files, at roughly 100ms each, which put the
  // hook within a second or two of Vitest's 5s default before anything went
  // wrong. Each delete targets a distinct user, so there is no ordering between
  // them and nothing to serialise.
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('adding to a collection', () => {
  it('lets an authenticated user with a profile add', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));

    const { error } = await add(client, user.id, albumA);
    expect(error).toBeNull();

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    expect(count).toBe(1);
  });

  it('creates exactly one entry', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));
    await add(client, user.id, albumA);

    const { data } = await admin.from('collection_entries').select('*').eq('user_id', user.id);
    expect(data).toHaveLength(1);
    expect(data![0].album_id).toBe(albumA);
    expect(data![0].rating).toBeNull();
    expect(data![0].liked).toBe(false);
    expect(data![0].relisten_count).toBe(0);
  });

  it('is idempotent when the same album is added repeatedly', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));

    await add(client, user.id, albumA);
    await add(client, user.id, albumA);
    await add(client, user.id, albumA);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(1);
  });

  it('clears Want to Listen for that album', async () => {
    const user = await createProfiledUser();
    await admin.from('want_to_listen').insert([
      { user_id: user.id, album_id: albumA },
      { user_id: user.id, album_id: albumB },
    ]);

    const client = await clientFor(await emailOf(user.id));
    await add(client, user.id, albumA);

    const { data } = await admin.from('want_to_listen').select('album_id').eq('user_id', user.id);
    expect(data).toHaveLength(1);
    expect(data![0].album_id).toBe(albumB);
  });

  it('creates no activity, because activity does not exist yet', async () => {
    // A guard against a later slice quietly writing events from this path.
    const { data: tables } = await admin.rpc('ensure_collection_entry', {
      p_user_id: (await createProfiledUser()).id,
      p_album_id: albumA,
    });
    expect(tables).toBeTruthy();

    const { error } = await admin.from('activity' as never).select('id');
    // The table genuinely does not exist; that is the assertion.
    expect(error).not.toBeNull();
  });
});

describe('collection state is per user', () => {
  it('does not show one user’s entry to another', async () => {
    const mine = await createProfiledUser();
    const theirs = await createProfiledUser();
    const myClient = await clientFor(await emailOf(mine.id));
    await add(myClient, mine.id, albumA);

    const { data } = await admin
      .from('collection_entries')
      .select('id')
      .eq('user_id', theirs.id)
      .eq('album_id', albumA);

    expect(data).toHaveLength(0);
  });

  it('keeps two users’ entries for the same album separate', async () => {
    const one = await createProfiledUser();
    const two = await createProfiledUser();
    await add(await clientFor(await emailOf(one.id)), one.id, albumA);
    await add(await clientFor(await emailOf(two.id)), two.id, albumA);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', albumA);
    expect(count).toBe(2);
  });
});

describe('authorisation', () => {
  it('refuses a user without a completed profile', async () => {
    const user = await createUser();
    const client = await clientFor(await emailOf(user.id));

    const { error } = await add(client, user.id, albumA);
    expect(error).not.toBeNull();

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(0);
  });

  it('refuses a signed-out caller', async () => {
    const user = await createProfiledUser();

    const { error } = await add(anon, user.id, albumA);
    expect(error).not.toBeNull();

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(0);
  });

  it('refuses one user adding on another’s behalf', async () => {
    const owner = await createProfiledUser();
    const intruder = await createProfiledUser();
    const client = await clientFor(await emailOf(intruder.id));

    // security invoker means RLS still applies inside the function, so it
    // cannot be used to write an entry for somebody else.
    const { error } = await add(client, owner.id, albumA);
    expect(error).not.toBeNull();
  });

  it('refuses one user removing another’s entry', async () => {
    const owner = await createProfiledUser();
    const intruder = await createProfiledUser();
    await add(await clientFor(await emailOf(owner.id)), owner.id, albumA);

    const client = await clientFor(await emailOf(intruder.id));
    await remove(client, owner.id, albumA);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner.id);
    expect(count).toBe(1);
  });
});

describe('removing from a collection', () => {
  it('removes the entry', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));
    await add(client, user.id, albumA);
    await remove(client, user.id, albumA);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(0);
  });

  it('deletes the review and the relisten history with it', async () => {
    // The locked semantics, and the reason the interface warns first.
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));
    const { data: entry } = await add(client, user.id, albumA);

    await admin.from('reviews').insert({ collection_entry_id: entry!.id, body: 'Considered.' });
    await admin
      .from('relisten_events')
      .insert([{ collection_entry_id: entry!.id }, { collection_entry_id: entry!.id }]);

    await remove(client, user.id, albumA);

    const [reviews, relistens] = await Promise.all([
      admin
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('collection_entry_id', entry!.id),
      admin
        .from('relisten_events')
        .select('id', { count: 'exact', head: true })
        .eq('collection_entry_id', entry!.id),
    ]);
    expect(reviews.count).toBe(0);
    expect(relistens.count).toBe(0);
  });

  it('leaves Want to Listen untouched', async () => {
    // The clearing rule runs one way only. Removal does not infer that the
    // user now intends to listen again.
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));
    await add(client, user.id, albumA);
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });

    await remove(client, user.id, albumA);

    const { count } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    expect(count).toBe(1);
  });

  it('leaves favourites untouched', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));
    await add(client, user.id, albumA);
    await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumA, position: 1 });

    await remove(client, user.id, albumA);

    const { count } = await admin
      .from('favourite_albums')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(1);
  });

  it('leaves the album’s other collectors alone', async () => {
    const one = await createProfiledUser();
    const two = await createProfiledUser();
    const oneClient = await clientFor(await emailOf(one.id));
    await add(oneClient, one.id, albumA);
    await add(await clientFor(await emailOf(two.id)), two.id, albumA);

    await remove(oneClient, one.id, albumA);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', albumA);
    expect(count).toBe(1);
  });

  it('is safe to call when nothing is there', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));
    const { error } = await remove(client, user.id, albumA);
    expect(error).toBeNull();
  });

  it('leaves the catalogue untouched', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(await emailOf(user.id));
    await add(client, user.id, albumA);
    await remove(client, user.id, albumA);

    const { count } = await admin.from('albums').select('id', { count: 'exact', head: true });
    expect(count).toBe(2);
  });
});
