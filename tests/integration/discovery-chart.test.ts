import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  browseLiveAlbum,
  browseReleaseGroup,
  collaborationAlbum,
  singleArtistAlbum,
} from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * "Popular this week", against the real database.
 *
 * **This is the layer that can prove the chart's semantics**, and almost none of
 * them can be proved anywhere else. Which activity qualifies, whose it is, how
 * repeated activity by one person is collapsed, and what the seven-day boundary
 * means are all properties of `refresh_popular_this_week()`, so they are
 * exercised here rather than through a rendered page.
 *
 * **The one invariant this file exists to make un-loseable** is that the chart
 * reads collection data and never `activity`. `product-spec.md` §8.3 requires
 * backfilled collection data to count — "interest is still interest" — while
 * `activity` exists precisely to exclude backfills. A future refactor reaching
 * for the obvious "activity" table would pass a casual review and silently
 * contradict a decided product rule, so there is a test whose whole purpose is
 * to fail if that happens.
 *
 * The fill rule itself is **not** here: it is pure and lives in
 * `src/services/discovery/chart.test.ts`.
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

const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;
let albumC: string;
let albumD: string;

async function createUser(): Promise<{ id: string; email: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `chart-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id, handle: `c_${stamp}`.slice(0, 30) });
  if (profileError) throw profileError;
  return { id, email };
}

/** A client carrying a real session, so RLS and grants apply as they do in the app. */
async function signedInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/**
 * A collection entry with an explicit `added_at`.
 *
 * Written directly rather than through `ensure_collection_entry`, because the
 * whole point of several tests below is to place a row on a chosen side of the
 * seven-day boundary — and because a row written this way generates **no
 * `activity` event**, which is exactly what a backfill looks like.
 */
async function addEntry(
  userId: string,
  albumId: string,
  options: { addedAt?: string; rating?: number; liked?: boolean; listenedOn?: string } = {},
): Promise<string> {
  const { data, error } = await admin
    .from('collection_entries')
    .insert({
      user_id: userId,
      album_id: albumId,
      added_at: options.addedAt ?? new Date().toISOString(),
      rating: options.rating ?? null,
      liked: options.liked ?? false,
      listened_on: options.listenedOn ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data!.id;
}

async function addRelisten(entryId: string, occurredAt = new Date().toISOString()) {
  const { error } = await admin
    .from('relisten_events')
    .insert({ collection_entry_id: entryId, occurred_at: occurredAt });
  if (error) throw error;
}

async function refresh(): Promise<number> {
  const { data, error } = await admin.rpc('refresh_popular_this_week');
  if (error) throw error;
  return data as number;
}

type ChartRow = {
  album_id: string;
  rank: number;
  distinct_users: number;
  collection_count: number;
};

async function chart(): Promise<ChartRow[]> {
  const { data, error } = await admin
    .from('discovery_chart_entries')
    .select('album_id, rank, distinct_users, collection_count')
    .eq('chart', 'popular_this_week')
    .order('rank', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChartRow[];
}

const usersFor = (rows: ChartRow[], albumId: string) =>
  rows.find((row) => row.album_id === albumId)?.distinct_users ?? 0;

beforeEach(async () => {
  await admin.from('discovery_chart_entries').delete().neq('chart', 'nothing-matches-this');
  await admin.from('activity').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('collection_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

beforeEach(async () => {
  if (albumA) return;
  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);
  await ingestReleaseGroupPayload(browseReleaseGroup, admin);
  await ingestReleaseGroupPayload(browseLiveAlbum, admin);
  const { data } = await admin.from('albums').select('id, mbid').order('mbid');
  albumA = data![0].id;
  albumB = data![1].id;
  albumC = data![2].id;
  albumD = data![3].id;
});

afterAll(async () => {
  await admin.from('discovery_chart_entries').delete().neq('chart', 'nothing-matches-this');
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('what counts as a qualifying user', () => {
  it('counts a collection addition', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });

  it('counts a relisten, reaching the user through the collection entry', async () => {
    // `relisten_events` carries no `user_id`. If ownership were resolved any
    // other way this test is where it breaks.
    const user = await createUser();
    const entry = await addEntry(user.id, albumA, { addedAt: daysAgo(30) });
    await addRelisten(entry);

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });

  it('counts one user who both added and relistened exactly once', async () => {
    const user = await createUser();
    const entry = await addEntry(user.id, albumA);
    await addRelisten(entry);

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });
});

describe('the anti-domination rule — distinct users is the whole of it', () => {
  it('one user relistening twenty times moves the chart by one', async () => {
    const user = await createUser();
    const entry = await addEntry(user.id, albumA, { addedAt: daysAgo(30) });
    for (let i = 0; i < 20; i += 1) await addRelisten(entry);

    await refresh();

    const rows = await chart();
    expect(usersFor(rows, albumA)).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('a user backfilling many albums adds at most +1 to each', async () => {
    // The plan's 300 is the shape, not the number: four albums prove the rule
    // and 300 would prove the same thing three hundred times more slowly.
    const user = await createUser();
    for (const album of [albumA, albumB, albumC, albumD]) await addEntry(user.id, album);

    await refresh();

    const rows = await chart();
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.distinct_users === 1)).toBe(true);
  });

  it('separate users accumulate', async () => {
    const one = await createUser();
    const two = await createUser();
    await addEntry(one.id, albumA);
    await addEntry(two.id, albumA);

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(2);
  });
});

describe('the seven-day window', () => {
  it('counts an addition inside the window', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA, { addedAt: daysAgo(6) });

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });

  it('excludes an addition outside the window', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA, { addedAt: daysAgo(8) });

    await refresh();

    expect(await chart()).toHaveLength(0);
  });

  it('excludes a relisten outside the window', async () => {
    const user = await createUser();
    const entry = await addEntry(user.id, albumA, { addedAt: daysAgo(30) });
    await addRelisten(entry, daysAgo(8));

    await refresh();

    expect(await chart()).toHaveLength(0);
  });

  it('an old entry relistened recently qualifies', async () => {
    const user = await createUser();
    const entry = await addEntry(user.id, albumA, { addedAt: daysAgo(400) });
    await addRelisten(entry, daysAgo(1));

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });
});

describe('added_at decides, never listened_on', () => {
  it('a recent addition with a decades-old listened_on counts', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA, { addedAt: daysAgo(1), listenedOn: '1997-01-01' });

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });

  it('an old addition with today as listened_on does not count', async () => {
    const user = await createUser();
    const today = new Date().toISOString().slice(0, 10);
    await addEntry(user.id, albumA, { addedAt: daysAgo(30), listenedOn: today });

    await refresh();

    expect(await chart()).toHaveLength(0);
  });
});

describe('signals that do not contribute', () => {
  it('a rating adds nothing beyond the entry that carries it', async () => {
    // Ratings belong to "Highest rated this week", which is slice 2 and is not
    // built. A rated entry outside the window must stay out.
    const user = await createUser();
    await addEntry(user.id, albumA, { addedAt: daysAgo(30), rating: 9.5 });

    await refresh();

    expect(await chart()).toHaveLength(0);
  });

  it('an album like adds nothing — §8.3 excludes them explicitly', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA, { addedAt: daysAgo(30), liked: true });

    await refresh();

    expect(await chart()).toHaveLength(0);
  });

  it('reviews, follows, review likes and list likes are not inputs at all', async () => {
    // None of these tables is reachable from the query. Asserting the absence of
    // a join is not possible directly, so this asserts the consequence: activity
    // on those surfaces, with no qualifying collection activity, yields nothing.
    const author = await createUser();
    const reader = await createUser();
    const entry = await addEntry(author.id, albumA, { addedAt: daysAgo(30) });

    const { error: reviewError } = await admin
      .from('reviews')
      .insert({ collection_entry_id: entry, body: 'A review, which is not popularity.' });
    if (reviewError) throw reviewError;

    const { error: followError } = await admin
      .from('follows')
      .insert({ follower_id: reader.id, followee_id: author.id });
    if (followError) throw followError;

    await refresh();

    expect(await chart()).toHaveLength(0);
  });
});

describe('the chart reads collection data, not the feed', () => {
  it('a backfilled entry counts even though it generates no activity row', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);

    const { count } = await admin
      .from('activity')
      .select('id', { count: 'exact', head: true })
      .eq('actor_id', user.id);
    expect(count).toBe(0);

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });

  it('is identical with and without the corresponding activity rows', async () => {
    // **The load-bearing test of this file.** If the query is ever re-sourced
    // from `activity`, the two snapshots stop matching and this fails.
    const user = await createUser();
    const entry = await addEntry(user.id, albumA);

    await refresh();
    const withoutActivity = await chart();

    const { error } = await admin
      .from('activity')
      .insert({ actor_id: user.id, type: 'listened', collection_entry_id: entry });
    if (error) throw error;

    await refresh();
    const withActivity = await chart();

    expect(withActivity).toEqual(withoutActivity);
  });
});

describe('external popularity is untouched by the internal chart', () => {
  it('ranks an album whose popularity_score is null', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);

    const { data: before } = await admin
      .from('albums')
      .select('popularity_score')
      .eq('id', albumA)
      .single();
    expect(before!.popularity_score).toBeNull();

    await refresh();

    expect(usersFor(await chart(), albumA)).toBe(1);
  });

  it('leaves every popularity_score unchanged across a refresh', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);

    const { error: seedError } = await admin
      .from('albums')
      .update({ popularity_score: 42 })
      .eq('id', albumB);
    if (seedError) throw seedError;

    const snapshot = async () =>
      (await admin.from('albums').select('id, popularity_score').order('id')).data;

    const before = await snapshot();
    await refresh();
    const after = await snapshot();

    expect(after).toEqual(before);
  });
});

describe('ranking', () => {
  it('orders by distinct users, then all-time collection count, then album id', async () => {
    const one = await createUser();
    const two = await createUser();
    const three = await createUser();

    // albumA: two qualifying users. albumB and albumC: one each, but albumB has
    // a larger all-time collection count from an entry outside the window.
    await addEntry(one.id, albumA);
    await addEntry(two.id, albumA);
    await addEntry(one.id, albumB);
    await addEntry(two.id, albumB, { addedAt: daysAgo(40) });
    await addEntry(three.id, albumB, { addedAt: daysAgo(40) });
    await addEntry(one.id, albumC);

    await refresh();
    const rows = await chart();

    expect(rows[0].album_id).toBe(albumA);
    expect(rows[0].distinct_users).toBe(2);
    expect(rows[1].album_id).toBe(albumB);
    expect(rows[1].collection_count).toBe(3);
    expect(rows[2].album_id).toBe(albumC);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('breaks a total tie on album id, deterministically across refreshes', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);
    await addEntry(user.id, albumB);
    await addEntry(user.id, albumC);

    await refresh();
    const first = await chart();
    await refresh();
    const second = await chart();

    expect(first.map((row) => row.album_id)).toEqual(
      [...first].sort((a, b) => a.album_id.localeCompare(b.album_id)).map((row) => row.album_id),
    );
    expect(second).toEqual(first);
  });
});

describe('the refresh itself', () => {
  it('is idempotent', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);

    const firstCount = await refresh();
    const first = await chart();
    const secondCount = await refresh();
    const second = await chart();

    expect(secondCount).toBe(firstCount);
    expect(second).toEqual(first);
  });

  it('replaces rather than accumulates', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);
    await refresh();
    expect(await chart()).toHaveLength(1);

    await admin.from('collection_entries').delete().eq('user_id', user.id);
    await addEntry(user.id, albumB);
    await refresh();

    const rows = await chart();
    expect(rows).toHaveLength(1);
    expect(rows[0].album_id).toBe(albumB);
  });

  it('writes a valid empty snapshot when nothing qualifies', async () => {
    expect(await refresh()).toBe(0);
    expect(await chart()).toHaveLength(0);
  });

  /**
   * **A rejected call leaves the snapshot alone, which is the weaker half of the
   * property and the only half this layer can prove.**
   *
   * The stronger claim — that a failure *inside* the function rolls the delete
   * back — holds because both statements share one plpgsql body and therefore one
   * transaction. It is **not covered by a test**, and that is recorded rather than
   * papered over: forcing a mid-function failure needs DDL (a constraint or
   * trigger added and dropped around the call) that the PostgREST surface these
   * tests use cannot issue. A test that called the RPC with a bogus argument
   * would be rejected before the function ran and would prove nothing at all.
   */
  it('leaves the previous snapshot intact when a refresh call is rejected', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);
    await refresh();
    const good = await chart();
    expect(good).toHaveLength(1);

    const { error } = await anon.rpc('refresh_popular_this_week');
    expect(error).not.toBeNull();

    expect(await chart()).toEqual(good);
  });
});

describe('privilege boundaries', () => {
  it('anon may read the chart', async () => {
    const user = await createUser();
    await addEntry(user.id, albumA);
    await refresh();

    const { data, error } = await anon
      .from('discovery_chart_entries')
      .select('album_id')
      .eq('chart', 'popular_this_week');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('anon may not write the chart', async () => {
    const { error } = await anon.from('discovery_chart_entries').insert({
      chart: 'popular_this_week',
      album_id: albumA,
      rank: 1,
      distinct_users: 1,
      collection_count: 1,
    });

    expect(error).not.toBeNull();
  });

  it('an authenticated user may not write the chart', async () => {
    const user = await createUser();
    const client = await signedInAs(user.email);

    const { error } = await client.from('discovery_chart_entries').insert({
      chart: 'popular_this_week',
      album_id: albumA,
      rank: 1,
      distinct_users: 1,
      collection_count: 1,
    });

    expect(error).not.toBeNull();
  });

  it('anon may not execute the refresh', async () => {
    const { error } = await anon.rpc('refresh_popular_this_week');

    expect(error?.code).toBe('42501');
    expect(error?.message ?? '').toMatch(/permission denied for function/i);
  });

  it('an authenticated user may not execute the refresh', async () => {
    const user = await createUser();
    const client = await signedInAs(user.email);

    const { error } = await client.rpc('refresh_popular_this_week');

    expect(error?.code).toBe('42501');
    expect(error?.message ?? '').toMatch(/permission denied for function/i);
  });

  it('rejects an unknown chart name', async () => {
    const { error } = await admin.from('discovery_chart_entries').insert({
      chart: 'highest_rated_this_week',
      album_id: albumA,
      rank: 1,
      distinct_users: 1,
      collection_count: 1,
    });

    // Slice 2 is not built, and the constraint says so rather than the reviewer.
    expect(error?.code).toBe('23514');
  });
});
