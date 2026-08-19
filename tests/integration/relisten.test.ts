import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Relisten, at the database contract.
 *
 * The interesting property here is not the mutation but the invariant: rows are
 * the truth and `relisten_count` is derived from them by trigger, so the two
 * must never disagree — including under concurrency, which is the case a
 * read-modify-write in application code would lose.
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
let albumB: string;

async function createUser(withProfile = true) {
  const email = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  if (withProfile) {
    const handle = `rl_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
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

/** Relisten, exactly as the service does: ensure the entry, then add an event. */
async function relisten(client: SupabaseClient<Database>, userId: string, albumId: string) {
  const { data: entry, error } = await client.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) return { error };
  return client.from('relisten_events').insert({ collection_entry_id: entry!.id });
}

async function stateOf(userId: string, albumId: string) {
  const { data: entry } = await admin
    .from('collection_entries')
    .select('id, relisten_count, rating, liked')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .maybeSingle();
  if (!entry) return null;
  const { count } = await admin
    .from('relisten_events')
    .select('id', { count: 'exact', head: true })
    .eq('collection_entry_id', entry.id);
  return { ...entry, events: count ?? 0 };
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
  // Deleted concurrently. Sequentially this was one round-trip per user — 40
  // to 70 of them in the larger files, at roughly 100ms each, which put the
  // hook within a second or two of Vitest's 5s default before anything went
  // wrong. Each delete targets a distinct user, so there is no ordering between
  // them and nothing to serialise.
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('relisten collects implicitly', () => {
  it('creates exactly one entry from an uncollected album', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await relisten(client, user.id, albumA);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(1);

    const state = await stateOf(user.id, albumA);
    expect(state!.relisten_count).toBe(1);
    // The implicit add claims nothing about a score or a like.
    expect(state!.rating).toBeNull();
    expect(state!.liked).toBe(false);
  });

  it('clears Want to Listen for that album only', async () => {
    const user = await createUser();
    await admin.from('want_to_listen').insert([
      { user_id: user.id, album_id: albumA },
      { user_id: user.id, album_id: albumB },
    ]);

    await relisten(await clientFor(user.email), user.id, albumA);

    const { data } = await admin.from('want_to_listen').select('album_id').eq('user_id', user.id);
    expect(data).toHaveLength(1);
    expect(data![0].album_id).toBe(albumB);
  });

  it('does not require a rating', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await relisten(client, user.id, albumA);
    await relisten(client, user.id, albumA);

    const state = await stateOf(user.id, albumA);
    expect(state!.rating).toBeNull();
    expect(state!.relisten_count).toBe(2);
  });
});

describe('counting', () => {
  it('increments on each relisten', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);

    for (const expected of [1, 2, 3]) {
      await relisten(client, user.id, albumA);
      expect((await stateOf(user.id, albumA))!.relisten_count).toBe(expected);
    }
  });

  it('records separate event rows rather than only a counter', async () => {
    // Three relistens are three feed items later; a single integer could not
    // express that, which is why the rows are the truth.
    const user = await createUser();
    const client = await clientFor(user.email);
    await relisten(client, user.id, albumA);
    await relisten(client, user.id, albumA);
    await relisten(client, user.id, albumA);

    const state = await stateOf(user.id, albumA);
    expect(state!.events).toBe(3);

    const { data } = await admin
      .from('relisten_events')
      .select('id, occurred_at')
      .eq('collection_entry_id', state!.id);
    expect(new Set(data!.map((r) => r.id)).size).toBe(3);
  });

  it('keeps the counter equal to the event-row count', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    for (let i = 0; i < 5; i += 1) await relisten(client, user.id, albumA);

    const state = await stateOf(user.id, albumA);
    expect(state!.relisten_count).toBe(state!.events);
    expect(state!.relisten_count).toBe(5);
  });

  it('stays correct under concurrent relistens', async () => {
    // The case a read-modify-write in application code loses. The trigger
    // increments in the same transaction as the insert, so the row lock
    // serialises them.
    const user = await createUser();
    const client = await clientFor(user.email);
    await relisten(client, user.id, albumA);

    await Promise.all(Array.from({ length: 15 }, () => relisten(client, user.id, albumA)));

    const state = await stateOf(user.id, albumA);
    expect(state!.events).toBe(16);
    expect(state!.relisten_count).toBe(16);
  });

  it('counts each album separately', async () => {
    const user = await createUser();
    const client = await clientFor(user.email);
    await relisten(client, user.id, albumA);
    await relisten(client, user.id, albumA);
    await relisten(client, user.id, albumB);

    expect((await stateOf(user.id, albumA))!.relisten_count).toBe(2);
    expect((await stateOf(user.id, albumB))!.relisten_count).toBe(1);
  });

  it('writes no activity, because activity does not exist yet', async () => {
    const user = await createUser();
    await relisten(await clientFor(user.email), user.id, albumA);
    const { error } = await admin.from('activity' as never).select('id');
    expect(error).not.toBeNull();
  });
});

describe('authorisation', () => {
  it('refuses a signed-out caller', async () => {
    const user = await createUser();
    const { error } = await relisten(anon, user.id, albumA);
    expect(error).not.toBeNull();
    expect(await stateOf(user.id, albumA)).toBeNull();
  });

  it('refuses a user without a completed profile', async () => {
    const user = await createUser(false);
    const { error } = await relisten(await clientFor(user.email), user.id, albumA);
    expect(error).not.toBeNull();
    expect(await stateOf(user.id, albumA)).toBeNull();
  });

  it('does not let one user add to another’s count', async () => {
    const owner = await createUser();
    const intruder = await createUser();
    await relisten(await clientFor(owner.email), owner.id, albumA);
    const before = await stateOf(owner.id, albumA);

    const intruderClient = await clientFor(intruder.email);
    await intruderClient.from('relisten_events').insert({ collection_entry_id: before!.id });

    const after = await stateOf(owner.id, albumA);
    expect(after!.relisten_count).toBe(1);
    expect(after!.events).toBe(1);
  });

  it('keeps two users’ counts on one album independent', async () => {
    const one = await createUser();
    const two = await createUser();
    const oneClient = await clientFor(one.email);
    await relisten(oneClient, one.id, albumA);
    await relisten(oneClient, one.id, albumA);
    await relisten(await clientFor(two.email), two.id, albumA);

    expect((await stateOf(one.id, albumA))!.relisten_count).toBe(2);
    expect((await stateOf(two.id, albumA))!.relisten_count).toBe(1);
  });
});
