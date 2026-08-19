import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Rating, at the database contract.
 *
 * The service layer cannot be called here — it builds a cookie-bound client and
 * there is no request scope in a test — so these exercise the same path it
 * uses: `ensure_collection_entry` to create, then an owner-scoped update.
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
let albumB: string;

async function createProfiledUser() {
  const email = `rate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const handle = `r_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({
    id: data.user.id,
    handle,
  });
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

/** Rate, exactly as the service does it: ensure the entry, then set the score. */
async function rate(
  client: SupabaseClient<Database>,
  userId: string,
  albumId: string,
  rating: number | null,
) {
  const { data: entry, error } = await client.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) return { error };
  return client.from('collection_entries').update({ rating }).eq('id', entry!.id);
}

async function ratingOf(userId: string, albumId: string) {
  const { data } = await admin
    .from('collection_entries')
    .select('rating')
    .eq('user_id', userId)
    .eq('album_id', albumId)
    .single();
  return data!.rating === null ? null : Number(data!.rating);
}

/** The read-time average, computed the way the service computes it. */
async function average(albumId: string) {
  const { data } = await admin
    .from('collection_entries')
    .select('rating')
    .eq('album_id', albumId)
    .not('rating', 'is', null);
  const ratings = (data ?? []).map((r) => Number(r.rating));
  if (ratings.length === 0) return { average: null as number | null, count: 0 };
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return { average: Math.round(mean * 10) / 10, count: ratings.length };
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

describe('valid scores', () => {
  it('accepts every tenth across the scale', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);

    for (const score of [0, 0.1, 2.5, 7.5, 9.9, 10]) {
      const { error } = await rate(client, user.id, albumA, score);
      expect(error, `score ${score}`).toBeFalsy();
      expect(await ratingOf(user.id, albumA)).toBe(score);
    }
  });

  it('treats 0.0 as a score rather than as absence', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 0);

    expect(await ratingOf(user.id, albumA)).toBe(0);
    expect(await average(albumA)).toEqual({ average: 0, count: 1 });
  });

  it('stores one decimal place', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 8.5);
    expect(await ratingOf(user.id, albumA)).toBe(8.5);
  });

  it('rounds a second decimal to one, rather than rejecting it', async () => {
    // numeric(3,1) rounds on the way in. Worth pinning: it means the column,
    // not the form, is the final word on precision.
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 8.44);
    expect(await ratingOf(user.id, albumA)).toBe(8.4);
  });
});

describe('invalid scores', () => {
  it('rejects values outside the scale', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);

    for (const score of [-0.1, -1, 10.1, 11]) {
      const result = await rate(client, user.id, albumA, score);
      expect(result.error?.code, `score ${score}`).toBe('23514');
    }
  });

  it('leaves the previous score intact when a bad one is refused', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 7);
    await rate(client, user.id, albumA, 99);
    expect(await ratingOf(user.id, albumA)).toBe(7);
  });
});

describe('rating creates and changes entries', () => {
  it('rating an uncollected album collects it', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);

    await rate(client, user.id, albumA, 9);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    expect(count).toBe(1);
  });

  it('rating an uncollected album clears Want to Listen', async () => {
    const user = await createProfiledUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });

    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 9);

    const { count } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    expect(count).toBe(0);
  });

  it('rating an already-collected album adds no second entry', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await client.rpc('ensure_collection_entry', { p_user_id: user.id, p_album_id: albumA });
    await rate(client, user.id, albumA, 6);

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(1);
  });

  it('lets a user change their score', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 4);
    await rate(client, user.id, albumA, 9.5);
    expect(await ratingOf(user.id, albumA)).toBe(9.5);
  });

  it('clears a score back to unrated rather than to zero', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 8);
    await rate(client, user.id, albumA, null);

    expect(await ratingOf(user.id, albumA)).toBeNull();
    // The entry survives: clearing a score is not leaving the collection.
    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);
    expect(count).toBe(1);
  });

  it('removes a cleared score from the average entirely', async () => {
    const keeper = await createProfiledUser();
    const clearer = await createProfiledUser();
    await rate(await clientFor(keeper.email), keeper.id, albumA, 10);
    const clearerClient = await clientFor(clearer.email);
    await rate(clearerClient, clearer.id, albumA, 0);

    expect(await average(albumA)).toEqual({ average: 5, count: 2 });

    await rate(clearerClient, clearer.id, albumA, null);

    // Not averaged as a zero — excluded outright.
    expect(await average(albumA)).toEqual({ average: 10, count: 1 });
  });

  it('writes no activity, because activity does not exist yet', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 7);
    const { error } = await admin.from('activity' as never).select('id');
    expect(error).not.toBeNull();
  });
});

describe('averages', () => {
  it('reports nothing for an album nobody rated', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await client.rpc('ensure_collection_entry', { p_user_id: user.id, p_album_id: albumA });
    expect(await average(albumA)).toEqual({ average: null, count: 0 });
  });

  it('excludes unrated entries from both average and count', async () => {
    const rater = await createProfiledUser();
    await rate(await clientFor(rater.email), rater.id, albumA, 6);
    for (let i = 0; i < 2; i += 1) {
      const other = await createProfiledUser();
      const client = await clientFor(other.email);
      await client.rpc('ensure_collection_entry', { p_user_id: other.id, p_album_id: albumA });
    }
    expect(await average(albumA)).toEqual({ average: 6, count: 1 });
  });

  it('averages across several users to one decimal', async () => {
    for (const score of [7, 8, 8.5]) {
      const user = await createProfiledUser();
      await rate(await clientFor(user.email), user.id, albumA, score);
    }
    // 23.5 / 3 = 7.8333…
    expect(await average(albumA)).toEqual({ average: 7.8, count: 3 });
  });

  it('keeps albums separate', async () => {
    const user = await createProfiledUser();
    const client = await clientFor(user.email);
    await rate(client, user.id, albumA, 10);
    await rate(client, user.id, albumB, 2);

    expect((await average(albumA)).average).toBe(10);
    expect((await average(albumB)).average).toBe(2);
  });
});

describe('ownership', () => {
  it('keeps two users’ scores for one album independent', async () => {
    const one = await createProfiledUser();
    const two = await createProfiledUser();
    await rate(await clientFor(one.email), one.id, albumA, 9);
    await rate(await clientFor(two.email), two.id, albumA, 3);

    expect(await ratingOf(one.id, albumA)).toBe(9);
    expect(await ratingOf(two.id, albumA)).toBe(3);
    expect(await average(albumA)).toEqual({ average: 6, count: 2 });
  });

  it('refuses one user rating another’s entry', async () => {
    const owner = await createProfiledUser();
    const intruder = await createProfiledUser();
    await rate(await clientFor(owner.email), owner.id, albumA, 9);

    const { data: entry } = await admin
      .from('collection_entries')
      .select('id')
      .eq('user_id', owner.id)
      .single();

    const intruderClient = await clientFor(intruder.email);
    await intruderClient.from('collection_entries').update({ rating: 1 }).eq('id', entry!.id);

    expect(await ratingOf(owner.id, albumA)).toBe(9);
  });
});
