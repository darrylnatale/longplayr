import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { allFixtures } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Favourites, at the database contract, and the profile read built on it.
 *
 * The schema-level invariants — the cap, the unique position, one album per
 * user — are proven in `collection.test.ts` and are not repeated here. What
 * this file owns is the part the profile depends on: that the read returns
 * albums in the owner's chosen order, to anyone, without leaking between users,
 * and that the position semantics `addFavourite` implements actually hold.
 *
 * `listProfileFavourites` cannot be called here — it builds a cookie-bound
 * client and there is no request scope — so these issue the same statement it
 * issues. The mapping that runs afterwards is unit-tested in
 * `src/services/collection/favourites.test.ts`.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

/** Auth-heavy, same budget and the same reasoning as every sibling suite. */
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
/** Every fixture album, so the position range can be exercised properly. */
let albums: string[] = [];

async function createProfiledUser() {
  const email = `fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const handle = `f_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, handle });
  if (profileError) throw profileError;

  return { id: data.user.id, handle };
}

/**
 * The statement `listProfileFavourites` issues, verbatim.
 *
 * Kept identical on purpose — if the service's select or ordering changes and
 * this does not, these tests stop describing the thing they claim to.
 */
async function readFavourites(client: SupabaseClient<Database>, userId: string) {
  const { data, error } = await client
    .from('favourite_albums')
    .select('id, album_id, position, albums(mbid, title, display_credit, artwork_status)')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * `addFavourite`'s position choice, replicated.
 *
 * The service picks the **lowest unused** position rather than one past the
 * highest, which is what makes an unpinned slot reusable instead of pushing the
 * next favourite past ten. Replicated rather than imported for the usual
 * reason, and pinned by test because the obvious implementation — `max + 1` —
 * passes every other assertion in this file while quietly making the eleventh
 * pin impossible after a single removal.
 */
async function pin(userId: string, albumId: string) {
  const existing = await readFavourites(admin, userId);
  if (existing.some((f) => f.album_id === albumId)) {
    return { row: existing.find((f) => f.album_id === albumId)!, created: false as const };
  }

  const taken = new Set(existing.map((f) => f.position));
  let position = 1;
  while (taken.has(position)) position += 1;

  const { data, error } = await admin
    .from('favourite_albums')
    .insert({ user_id: userId, album_id: albumId, position })
    .select()
    .single();

  if (error) throw error;
  return { row: data, created: true as const };
}

/**
 * `addFavourite` in full: the count guard, and — the part that matters here —
 * the **translation of a schema rejection into `favourites_full`**.
 *
 * The service has two routes to that outcome. The count guard refuses before
 * touching the database, and is racy on its own: two requests can each observe
 * nine. The second route is the one the schema guarantees — a CHECK or UNIQUE
 * violation coming back from the insert is turned into the same friendly
 * result rather than thrown. That second route is reachable with the fixture
 * catalogue, and is what these tests exercise.
 *
 * `position` may be forced, which is how a rejection is provoked without
 * needing eleven albums to walk up to it.
 */
async function tryPin(userId: string, albumId: string, forcePosition?: number) {
  const existing = await readFavourites(admin, userId);
  if (existing.some((f) => f.album_id === albumId)) {
    return { ok: true as const, created: false as const };
  }
  if (existing.length >= 10) {
    return { ok: false as const, error: 'favourites_full' as const };
  }

  const taken = new Set(existing.map((f) => f.position));
  let position = 1;
  while (taken.has(position)) position += 1;
  if (forcePosition !== undefined) position = forcePosition;

  const { data, error } = await admin
    .from('favourite_albums')
    .insert({ user_id: userId, album_id: albumId, position })
    .select()
    .single();

  if (error) {
    // Exactly what the service does: the schema is the real cap, and a
    // violation from it is still an outcome the interface can render rather
    // than a crash.
    if (error.code === '23514' || error.code === '23505') {
      return { ok: false as const, error: 'favourites_full' as const };
    }
    return { ok: false as const, error: error.code };
  }
  return { ok: true as const, created: true as const, row: data };
}

async function unpin(userId: string, albumId: string) {
  const { error } = await admin
    .from('favourite_albums')
    .delete()
    .eq('user_id', userId)
    .eq('album_id', albumId);
  if (error) throw error;
}

async function ensureEntry(userId: string, albumId: string) {
  const { data, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) throw error;
  return data!;
}

const countEntries = async (userId: string) =>
  (
    await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
  ).count;

beforeAll(() => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing. Run `npm run db:env`.');
});

beforeEach(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');

  // Every fixture, not two: the position range needs more than a handful of
  // albums to exercise, and the singles among them are rejected at ingest
  // anyway.
  for (const fixture of Object.values(allFixtures)) {
    await ingestReleaseGroupPayload(fixture, admin);
  }

  const { data } = await admin.from('albums').select('id').order('title');
  albums = (data ?? []).map((a) => a.id);
  expect(albums.length).toBeGreaterThanOrEqual(7);
});

afterAll(async () => {
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('independence from the collection', () => {
  it('pins an album that is not collected, and collects nothing', async () => {
    // The decision this whole relation exists to express: a favourite is a
    // statement about taste, not a record of listening.
    const user = await createProfiledUser();

    await pin(user.id, albums[0]);

    expect(await countEntries(user.id)).toBe(0);
    expect(await readFavourites(admin, user.id)).toHaveLength(1);
  });

  it('pins an album that is already collected, without disturbing the entry', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albums[0]);
    await admin.from('collection_entries').update({ rating: 8.4, liked: true }).eq('id', entry.id);

    await pin(user.id, albums[0]);

    const { data: after } = await admin
      .from('collection_entries')
      .select('id, rating, liked')
      .eq('id', entry.id)
      .single();

    // Same entry, same score, same like. Pinning is not a mutation of the
    // collection in either direction.
    expect(after!.id).toBe(entry.id);
    expect(Number(after!.rating)).toBe(8.4);
    expect(after!.liked).toBe(true);
    expect(await countEntries(user.id)).toBe(1);
  });

  it('leaves the collection alone when a favourite is removed', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albums[0]);
    await pin(user.id, albums[0]);

    await unpin(user.id, albums[0]);

    expect(await readFavourites(admin, user.id)).toHaveLength(0);
    expect(await countEntries(user.id)).toBe(1);
  });
});

describe('the other relations are untouched', () => {
  it('leaves Want to Listen alone when an album is pinned', async () => {
    // The clearing rule fires on a collection entry being *created*. Pinning
    // creates no entry, so it must clear nothing — an album can legitimately be
    // wanted and favourited at once.
    const user = await createProfiledUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albums[0] });

    await pin(user.id, albums[0]);

    const { count } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albums[0]);

    expect(count).toBe(1);
    expect(await countEntries(user.id)).toBe(0);
  });

  it('leaves rating, like and relisten count intact across pin and unpin', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albums[0]);
    await admin.from('collection_entries').update({ rating: 7.3, liked: true }).eq('id', entry.id);
    await admin
      .from('relisten_events')
      .insert([{ collection_entry_id: entry.id }, { collection_entry_id: entry.id }]);

    const before = await admin
      .from('collection_entries')
      .select('rating, liked, relisten_count, listened_on, added_at')
      .eq('id', entry.id)
      .single();

    await pin(user.id, albums[0]);
    await unpin(user.id, albums[0]);

    const after = await admin
      .from('collection_entries')
      .select('rating, liked, relisten_count, listened_on, added_at')
      .eq('id', entry.id)
      .single();

    // Byte for byte the same row. Neither direction of the toggle is a
    // collection mutation.
    expect(after.data).toEqual(before.data);
    expect(before.data!.relisten_count).toBe(2);
  });
});

describe('favourite and like are independent', () => {
  // Four combinations, because these are different relations and a shortcut
  // that derived one from the other would satisfy any single case.
  it('holds liked without favourite', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albums[0]);
    await admin.from('collection_entries').update({ liked: true }).eq('id', entry.id);

    expect(await readFavourites(admin, user.id)).toHaveLength(0);
    const { data } = await admin
      .from('collection_entries')
      .select('liked')
      .eq('id', entry.id)
      .single();
    expect(data!.liked).toBe(true);
  });

  it('holds favourite without liked, and without a collection entry at all', async () => {
    const user = await createProfiledUser();
    await pin(user.id, albums[0]);

    expect(await readFavourites(admin, user.id)).toHaveLength(1);
    expect(await countEntries(user.id)).toBe(0);
  });

  it('holds both at once', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albums[0]);
    await admin.from('collection_entries').update({ liked: true }).eq('id', entry.id);
    await pin(user.id, albums[0]);

    const { data } = await admin
      .from('collection_entries')
      .select('liked')
      .eq('id', entry.id)
      .single();

    expect(data!.liked).toBe(true);
    expect(await readFavourites(admin, user.id)).toHaveLength(1);
  });

  it('holds neither', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albums[0]);

    const { data } = await admin
      .from('collection_entries')
      .select('liked')
      .eq('user_id', user.id)
      .single();

    expect(data!.liked).toBe(false);
    expect(await readFavourites(admin, user.id)).toHaveLength(0);
  });
});

describe('concurrency', () => {
  it('writes one row when the same album is pinned many times at once', async () => {
    // The service reads then inserts, which is racy by construction. What makes
    // it safe is `unique (user_id, album_id)` — the database, not the check.
    const user = await createProfiledUser();

    const attempts = Array.from({ length: 6 }, (_, i) =>
      admin
        .from('favourite_albums')
        .insert({ user_id: user.id, album_id: albums[0], position: i + 1 }),
    );
    await Promise.allSettled(attempts);

    const rows = await readFavourites(admin, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].album_id).toBe(albums[0]);
  });

  it('lets only one insert win a contested position', async () => {
    // This is the mechanism that caps the table. `unique (user_id, position)`
    // with the 1-10 range means ten slots exist and each holds one row, so no
    // amount of concurrency can produce an eleventh — there is nowhere to put
    // it. Proven on the slot rather than on a row count, which is what makes it
    // independent of how many albums happen to exist.
    const user = await createProfiledUser();

    const attempts = albums
      .slice(0, 7)
      .map((albumId) =>
        admin.from('favourite_albums').insert({ user_id: user.id, album_id: albumId, position: 3 }),
      );
    await Promise.allSettled(attempts);

    const rows = await readFavourites(admin, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(3);
  });

  it('admits nothing outside the range, however many race for it', async () => {
    const user = await createProfiledUser();

    await Promise.allSettled(
      albums
        .slice(0, 7)
        .map((albumId, i) =>
          admin
            .from('favourite_albums')
            .insert({ user_id: user.id, album_id: albumId, position: 11 + i }),
        ),
    );

    expect(await readFavourites(admin, user.id)).toHaveLength(0);
  });
});

describe('the ten-favourite limit', () => {
  /**
   * **The cap is the position range, not a row count**, and that is what makes
   * it testable here. `position between 1 and 10` plus `unique (user_id,
   * position)` means ten slots exist per user and each holds at most one row,
   * so the table is bounded at ten by construction — with no counter to drift
   * and no dependence on how many albums the catalogue holds.
   *
   * That distinction is load-bearing for these tests. The fixture catalogue
   * yields seven albums and a user may pin an album only once, so no user
   * reachable from here can hold ten rows. Manufacturing four more albums to
   * walk up to the boundary was considered and rejected: it would prove the
   * service's count guard while saying nothing new about the invariant that
   * actually holds the line, and the catalogue is read-only downstream of
   * MusicBrainz. The slots are tested directly instead.
   *
   * **What is therefore not covered**: `addFavourite`'s pre-insert count guard
   * firing at exactly ten. It is the friendly message, not the guarantee — it
   * is racy by construction, which is precisely why the schema exists — and its
   * outcome, `favourites_full`, is covered below through the branch the schema
   * drives.
   */
  it('accepts every position from one to ten', async () => {
    // One user per slot, because a single user cannot reach ten with seven
    // albums. What is under test is the range the constraint admits.
    for (let position = 1; position <= 10; position += 1) {
      const user = await createProfiledUser();
      const { error } = await admin
        .from('favourite_albums')
        .insert({ user_id: user.id, album_id: albums[0], position });

      expect(error, `position ${position} should be accepted`).toBeNull();
    }
  });

  it('refuses an eleventh slot', async () => {
    const user = await createProfiledUser();
    const { error } = await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albums[0], position: 11 });

    expect(error?.code).toBe('23514');
  });

  it('refuses a position below one', async () => {
    // The other end of the same constraint. Without it, an off-by-one in a
    // future reorder could park rows at zero and quietly widen the cap.
    const user = await createProfiledUser();

    for (const position of [0, -1]) {
      const { error } = await admin
        .from('favourite_albums')
        .insert({ user_id: user.id, album_id: albums[0], position });
      expect(error?.code).toBe('23514');
    }
  });

  it('holds every slot a user has already taken', async () => {
    // Ten slots only cap the table if each is exclusive. Seven albums fill
    // seven slots; every one of them then refuses a second occupant.
    const user = await createProfiledUser();
    for (const album of albums.slice(0, 7)) await pin(user.id, album);

    const rows = await readFavourites(admin, user.id);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    for (const position of rows.map((r) => r.position)) {
      const { error } = await admin
        .from('favourite_albums')
        .insert({ user_id: user.id, album_id: albums[0], position });
      expect(error?.code).toBe('23505');
    }
  });

  it('turns a refused slot into favourites_full rather than an exception', async () => {
    // The friendly outcome, through the branch the schema drives — the same
    // mapping `addFavourite` applies when a rejection comes back from the
    // insert. This is the route that survives a race, and the one reachable
    // without inventing albums.
    const user = await createProfiledUser();
    for (const album of albums.slice(0, 3)) await pin(user.id, album);

    const refused = await tryPin(user.id, albums[3], 11);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toBe('favourites_full');
  });

  it('writes nothing when the attempt is refused', async () => {
    const user = await createProfiledUser();
    for (const album of albums.slice(0, 3)) await pin(user.id, album);

    const before = await readFavourites(admin, user.id);
    const refused = await tryPin(user.id, albums[3], 11);
    const after = await readFavourites(admin, user.id);

    expect(refused.ok).toBe(false);
    // Same rows, same slots, and the refused album is nowhere.
    expect(after.map((r) => [r.album_id, r.position])).toEqual(
      before.map((r) => [r.album_id, r.position]),
    );
    expect(after).toHaveLength(3);
    expect(after.some((r) => r.album_id === albums[3])).toBe(false);
  });
});

describe('a user without a profile', () => {
  it('cannot hold a favourite at all', async () => {
    // The invariant behind `onboarding_required`: `favourite_albums.user_id`
    // references `profiles`, so an authenticated user mid-onboarding has no row
    // to reference. The service returns a friendly outcome; this is why it has
    // to. Phase 1 shipped the opposite bug — an audit insert that failed
    // silently — so the foreign key is the thing worth pinning.
    const email = `fav-np-${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'correct-horse-battery',
      email_confirm: true,
    });
    if (error) throw error;
    createdUserIds.push(data.user.id);

    const { error: insertError } = await admin
      .from('favourite_albums')
      .insert({ user_id: data.user.id, album_id: albums[0], position: 1 });

    expect(insertError?.code).toBe('23503');
  });
});

describe('ordering', () => {
  it('returns favourites by position, not by when they were pinned', async () => {
    const user = await createProfiledUser();

    // Pinned in catalogue order, then given a deliberate arrangement.
    await pin(user.id, albums[0]);
    await pin(user.id, albums[1]);
    await pin(user.id, albums[2]);

    // Reverse it: the newest pin becomes first.
    await admin
      .from('favourite_albums')
      .update({ position: 9 })
      .eq('user_id', user.id)
      .eq('album_id', albums[0]);

    const rows = await readFavourites(admin, user.id);

    expect(rows.map((r) => r.position)).toEqual([2, 3, 9]);
    expect(rows.map((r) => r.album_id)).toEqual([albums[1], albums[2], albums[0]]);
  });

  it('preserves gaps rather than renumbering', async () => {
    // Unpinning the middle of a run leaves a hole. The arrangement is the
    // user's, and closing the gap on their behalf would silently reorder it.
    const user = await createProfiledUser();
    for (const album of albums.slice(0, 4)) await pin(user.id, album);

    await unpin(user.id, albums[2]);

    const rows = await readFavourites(admin, user.id);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 4]);
  });

  it('carries the album identity and artwork the row renders', async () => {
    const user = await createProfiledUser();
    await pin(user.id, albums[0]);

    const [row] = await readFavourites(admin, user.id);

    expect(row.albums).not.toBeNull();
    expect(row.albums!.mbid).toBeTruthy();
    expect(row.albums!.title).toBeTruthy();
    expect(row.albums!.display_credit).toBeTruthy();
    expect(row.albums!.artwork_status).toBeTruthy();
  });
});

describe('positions reopen', () => {
  it('reuses the lowest freed position rather than pushing past the last', async () => {
    // The semantic that keeps ten reachable forever. `max + 1` would pass every
    // other test here and strand a user at ten pins after one removal.
    const user = await createProfiledUser();
    for (const album of albums.slice(0, 4)) await pin(user.id, album);

    await unpin(user.id, albums[1]); // frees position 2

    const { row } = await pin(user.id, albums[4]);
    expect(row.position).toBe(2);

    const rows = await readFavourites(admin, user.id);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });

  it('starts again at one when everything is unpinned', async () => {
    const user = await createProfiledUser();
    await pin(user.id, albums[0]);
    await pin(user.id, albums[1]);

    await unpin(user.id, albums[0]);
    await unpin(user.id, albums[1]);

    const { row } = await pin(user.id, albums[2]);
    expect(row.position).toBe(1);
  });
});

describe('pinning the same album twice', () => {
  it('is idempotent through the service path — the existing pin comes back', async () => {
    const user = await createProfiledUser();
    const first = await pin(user.id, albums[0]);
    const second = await pin(user.id, albums[0]);

    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.position).toBe(first.row.position);
    expect(await readFavourites(admin, user.id)).toHaveLength(1);
  });

  it('is refused by the schema when the service check is bypassed', async () => {
    const user = await createProfiledUser();
    await pin(user.id, albums[0]);

    const { error } = await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albums[0], position: 5 });

    expect(error?.code).toBe('23505');
  });
});

describe('visibility', () => {
  it('returns only the requested user’s favourites', async () => {
    const mine = await createProfiledUser();
    const theirs = await createProfiledUser();

    await pin(mine.id, albums[0]);
    await pin(theirs.id, albums[1]);
    await pin(theirs.id, albums[2]);

    const myRows = await readFavourites(admin, mine.id);
    const theirRows = await readFavourites(admin, theirs.id);

    expect(myRows).toHaveLength(1);
    expect(myRows[0].album_id).toBe(albums[0]);
    expect(theirRows).toHaveLength(2);
    expect(myRows.map((r) => r.album_id)).not.toContain(albums[1]);
  });

  it('lets two users pin the same album at the same position', async () => {
    // The unique constraints are per user. Nothing about one person's
    // arrangement constrains anyone else's.
    const mine = await createProfiledUser();
    const theirs = await createProfiledUser();

    const a = await pin(mine.id, albums[0]);
    const b = await pin(theirs.id, albums[0]);

    expect(a.row.position).toBe(1);
    expect(b.row.position).toBe(1);
  });

  it('is readable signed out, because everything user-generated is public', async () => {
    const user = await createProfiledUser();
    await pin(user.id, albums[0]);
    await pin(user.id, albums[1]);

    const rows = await readFavourites(anon, user.id);

    expect(rows).toHaveLength(2);
    expect(rows[0].albums!.title).toBeTruthy();
  });

  it('returns nothing for a user with no favourites', async () => {
    const user = await createProfiledUser();
    expect(await readFavourites(admin, user.id)).toEqual([]);
  });
});
