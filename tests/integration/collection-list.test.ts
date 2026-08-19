import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  collaborationAlbum,
  singleArtistAlbum,
  variousArtistsCompilation,
} from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * The collection read, at the database contract.
 *
 * `listCollection` cannot be called here — it builds a cookie-bound client and
 * there is no request scope in a test — so these issue the same statement it
 * issues, which is the convention every other suite in this directory follows.
 * The mapping that runs on the rows afterwards is unit-tested separately in
 * `src/services/collection/collection-list.test.ts`.
 *
 * The load-bearing test in this file is the ordering one. `added_at desc` is a
 * decision, not an implementation detail, and the plausible-looking alternative
 * — `coalesce(listened_on, added_at)` — is specifically what it must not be.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

/**
 * Auth-heavy: this file creates real users through GoTrue and signs in as them.
 * Same reasoning, and the same budget, as every other auth-touching suite here.
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
let albumC: string;

async function createProfiledUser() {
  const email = `lst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const handle = `l_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, handle });
  if (profileError) throw profileError;

  return { id: data.user.id, handle };
}

async function ensureEntry(userId: string, albumId: string, listenedOn: string | null = null) {
  const { data, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
    p_listened_on: listenedOn ?? undefined,
  });
  if (error) throw error;
  return data!;
}

/** `added_at` defaults to now(), so ordering cases set it explicitly. */
async function setAddedAt(entryId: string, iso: string) {
  const { error } = await admin
    .from('collection_entries')
    .update({ added_at: iso })
    .eq('id', entryId);
  if (error) throw error;
}

/**
 * The statement `listCollection` issues, verbatim.
 *
 * Kept identical on purpose — if the service's select or ordering changes and
 * this does not, these tests stop describing the thing they claim to.
 */
async function readCollection(client: SupabaseClient<Database>, userId: string) {
  const { data, error } = await client
    .from('collection_entries')
    .select(
      'id, album_id, rating, liked, relisten_count, albums(mbid, title, display_credit, artwork_status, first_release_date)',
    )
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

const titlesOf = (rows: Awaited<ReturnType<typeof readCollection>>) =>
  rows.map((row) => row.albums?.title);

beforeAll(() => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing. Run `npm run db:env`.');
});

beforeEach(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');

  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);
  await ingestReleaseGroupPayload(variousArtistsCompilation, admin);

  const { data } = await admin.from('albums').select('id').order('title');
  albumA = data![0].id;
  albumB = data![1].id;
  albumC = data![2].id;
});

afterAll(async () => {
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('ordering', () => {
  it('returns the most recently added album first', async () => {
    const user = await createProfiledUser();

    const first = await ensureEntry(user.id, albumA);
    const second = await ensureEntry(user.id, albumB);
    const third = await ensureEntry(user.id, albumC);

    await setAddedAt(first.id, '2026-01-01T00:00:00Z');
    await setAddedAt(second.id, '2026-06-01T00:00:00Z');
    await setAddedAt(third.id, '2026-08-01T00:00:00Z');

    const rows = await readCollection(admin, user.id);

    expect(rows).toHaveLength(3);
    expect(rows[0].album_id).toBe(albumC);
    expect(rows[1].album_id).toBe(albumB);
    expect(rows[2].album_id).toBe(albumA);
  });

  it('ignores listened_on entirely, however far it is backdated', async () => {
    // The decision this file exists to protect. A collection answers "what have
    // I most recently added", which is a fact about the account. `listened_on`
    // is a user-asserted claim about the past, and ordering by it would let
    // someone backfilling records from 1997 push everything they added this
    // week off the front of their own collection.
    //
    // Both plausible-looking alternatives fail here: ordering by `listened_on`
    // outright, and `coalesce(listened_on, added_at)`.
    const user = await createProfiledUser();

    const oldListen = await ensureEntry(user.id, albumA, '1997-05-21');
    const noListen = await ensureEntry(user.id, albumB);

    // The backdated listen is the *newer* addition.
    await setAddedAt(noListen.id, '2026-01-01T00:00:00Z');
    await setAddedAt(oldListen.id, '2026-08-01T00:00:00Z');

    const rows = await readCollection(admin, user.id);

    expect(rows[0].album_id).toBe(oldListen.album_id);
    expect(rows[1].album_id).toBe(noListen.album_id);
  });
});

describe('user isolation', () => {
  it('returns only the requested user’s entries', async () => {
    const mine = await createProfiledUser();
    const theirs = await createProfiledUser();

    await ensureEntry(mine.id, albumA);
    await ensureEntry(theirs.id, albumB);
    await ensureEntry(theirs.id, albumC);

    const myRows = await readCollection(admin, mine.id);
    const theirRows = await readCollection(admin, theirs.id);

    expect(myRows).toHaveLength(1);
    expect(myRows[0].album_id).toBe(albumA);

    expect(theirRows).toHaveLength(2);
    expect(theirRows.map((r) => r.album_id).sort()).toEqual([albumB, albumC].sort());
  });

  it('never leaks one user’s score, like or relisten count into another’s row', async () => {
    const mine = await createProfiledUser();
    const theirs = await createProfiledUser();

    const myEntry = await ensureEntry(mine.id, albumA);
    const theirEntry = await ensureEntry(theirs.id, albumA);

    await admin.from('collection_entries').update({ rating: 2.5 }).eq('id', myEntry.id);
    await admin
      .from('collection_entries')
      .update({ rating: 9.9, liked: true })
      .eq('id', theirEntry.id);
    await admin.from('relisten_events').insert({ collection_entry_id: theirEntry.id });

    const [myRow] = await readCollection(admin, mine.id);

    // The same album, held by both. Everything personal must come from my row.
    expect(Number(myRow.rating)).toBe(2.5);
    expect(myRow.liked).toBe(false);
    expect(myRow.relisten_count).toBe(0);
  });
});

describe('an empty collection', () => {
  it('returns no rows rather than failing', async () => {
    const user = await createProfiledUser();
    expect(await readCollection(admin, user.id)).toEqual([]);
  });

  it('returns no rows for a user id that does not exist', async () => {
    const rows = await readCollection(admin, '00000000-0000-0000-0000-000000000000');
    expect(rows).toEqual([]);
  });
});

describe('tile markers', () => {
  it('distinguishes rated from unrated, and keeps 0.0 as a score', async () => {
    const user = await createProfiledUser();

    const rated = await ensureEntry(user.id, albumA);
    const zero = await ensureEntry(user.id, albumB);
    await ensureEntry(user.id, albumC);

    await admin.from('collection_entries').update({ rating: 8.5 }).eq('id', rated.id);
    await admin.from('collection_entries').update({ rating: 0 }).eq('id', zero.id);

    const rows = await readCollection(admin, user.id);
    const byAlbum = new Map(rows.map((row) => [row.album_id, row]));

    expect(Number(byAlbum.get(albumA)!.rating)).toBe(8.5);
    // 0.0 is a real score and must arrive as one, not as null.
    expect(byAlbum.get(albumB)!.rating).not.toBeNull();
    expect(Number(byAlbum.get(albumB)!.rating)).toBe(0);
    expect(byAlbum.get(albumC)!.rating).toBeNull();
  });

  it('distinguishes liked from unliked', async () => {
    const user = await createProfiledUser();

    const liked = await ensureEntry(user.id, albumA);
    await ensureEntry(user.id, albumB);
    await admin.from('collection_entries').update({ liked: true }).eq('id', liked.id);

    const rows = await readCollection(admin, user.id);
    const byAlbum = new Map(rows.map((row) => [row.album_id, row]));

    expect(byAlbum.get(albumA)!.liked).toBe(true);
    expect(byAlbum.get(albumB)!.liked).toBe(false);
  });

  it('carries the relisten count maintained by the trigger', async () => {
    const user = await createProfiledUser();

    const entry = await ensureEntry(user.id, albumA);
    await ensureEntry(user.id, albumB);

    await admin
      .from('relisten_events')
      .insert([
        { collection_entry_id: entry.id },
        { collection_entry_id: entry.id },
        { collection_entry_id: entry.id },
      ]);

    const rows = await readCollection(admin, user.id);
    const byAlbum = new Map(rows.map((row) => [row.album_id, row]));

    expect(byAlbum.get(albumA)!.relisten_count).toBe(3);
    // Added but never replayed. An entry is not itself a relisten.
    expect(byAlbum.get(albumB)!.relisten_count).toBe(0);
  });

  it('carries the album fields a tile renders', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albumA);

    const [row] = await readCollection(admin, user.id);

    expect(row.albums).not.toBeNull();
    expect(row.albums!.title).toBe('In Rainbows');
    expect(row.albums!.display_credit).toBe('Radiohead');
    expect(row.albums!.mbid).toBeTruthy();
    expect(row.albums!.first_release_date).toBeTruthy();
  });
});

describe('multiple albums', () => {
  it('returns every entry the user holds, once each', async () => {
    const user = await createProfiledUser();

    await ensureEntry(user.id, albumA);
    await ensureEntry(user.id, albumB);
    await ensureEntry(user.id, albumC);
    // One entry per user per album, permanently — re-running the canonical path
    // must not produce a second row in the collection.
    await ensureEntry(user.id, albumA);

    const rows = await readCollection(admin, user.id);

    expect(rows).toHaveLength(3);
    expect(new Set(titlesOf(rows)).size).toBe(3);
  });
});

describe('public visibility', () => {
  it('is readable signed out, because everything user-generated is public', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);
    await admin.from('collection_entries').update({ rating: 7.1, liked: true }).eq('id', entry.id);

    // The anon key, with no session at all.
    const rows = await readCollection(anon, user.id);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rating)).toBe(7.1);
    expect(rows[0].liked).toBe(true);
    expect(rows[0].albums!.title).toBe('In Rainbows');
  });
});
