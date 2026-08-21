import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  collaborationAlbum,
  messyReleaseGroup,
  mixtapeWithoutPrimaryType,
  multiDiscAlbum,
  singleArtistAlbum,
  variousArtistsCompilation,
  yearOnlyAlbum,
} from '@/services/catalogue/fixtures';
import type { MbReleaseGroup } from '@/services/catalogue/musicbrainz';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import { collectionOrder, type CollectionSort } from '@/services/collection/sort';

/**
 * Collection sorting, at the database contract.
 *
 * `listCollection` cannot be called here — it builds a cookie-bound client and
 * there is no request scope in a test — so this issues the same statement it
 * issues, which is the convention every suite in this directory follows. What
 * is different, and deliberate: **the ordering is driven by `collectionOrder`
 * itself rather than by hand-written `.order()` calls.** A hand-copy would let
 * the service change its clauses while these tests kept proving the old ones,
 * which is the specific way an ordering test stops describing the thing it
 * claims to. The clauses' own shape is pinned separately in
 * `src/services/collection/sort.test.ts`.
 *
 * The load-bearing cases are the ones with a plausible wrong answer:
 *
 *  - **`listened_on` reorders under Listened and nowhere else.** The default is
 *    still `added_at` descending, and a backdated date must not disturb it.
 *  - **`0.0` is the lowest score, not "unrated".** Unrated sorts last and stays
 *    visible.
 *  - **An undated album sorts last**, not first — reversing a comparator is the
 *    obvious implementation and it floats undated rows to the top.
 *  - **Paging under a sort with ties returns each album exactly once.** Without
 *    the `added_at` tiebreaker a tied row has no defined position and can land
 *    on two pages, or on none.
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

/**
 * An album the catalogue holds no release date for.
 *
 * **Test-local, and deliberately not a fixture.** The seeded catalogue
 * (`db:seed:fixtures`) is left exactly as it is: every album in it carries a
 * date, which is why the undated case cannot be reached from a browser and is
 * proven here instead. This payload is ingested into a database the suite
 * truncates either side of every test, so no permanent catalogue record is
 * manufactured.
 *
 * `'first-release-date'` is simply absent — `mapReleaseGroup` maps a missing
 * date to `null`, which is the real shape MusicBrainz returns for a release
 * group nobody has dated.
 *
 * The title and credit both sort near the end of their runs, so this row also
 * pins that an undated album is ordered normally under Title and Artist and
 * only sinks under Year.
 */
const undatedAlbum: MbReleaseGroup = {
  id: '0b0e4f1e-1111-4000-8000-0000000000f1',
  title: 'Undated Sessions',
  'primary-type': 'Album',
  'secondary-types': [],
  'artist-credit': [
    {
      name: 'Zephyr Quartet',
      artist: {
        id: '0b0e4f1e-3333-4000-8000-0000000000f1',
        name: 'Zephyr Quartet',
        'sort-name': 'Zephyr Quartet',
        type: 'Group',
      },
    },
  ],
  releases: [],
};

/** Every album this file works with, and what each one is here to prove. */
const PAYLOADS = [
  singleArtistAlbum, //           In Rainbows        · Radiohead          · 2007-10-10
  collaborationAlbum, //          Watch the Throne   · Jay-Z & Kanye West · 2011-08-08
  variousArtistsCompilation, //   Now That's ... 100 · Various Artists    · 2018-01-01
  mixtapeWithoutPrimaryType, //   Acid Rap           · Chance the Rapper  · 2013-04-30
  yearOnlyAlbum, //               Unknown Pleasures  · Joy Division       · 1979-01-01
  multiDiscAlbum, //              Sandinista!        · The Clash          · 1980-12-12
  messyReleaseGroup, //           Bootlegged Session · Some Artist        · 1998-01-01
  undatedAlbum, //                Undated Sessions   · Zephyr Quartet     · (none)
];

const createdUserIds: string[] = [];

/** Album id by title, rebuilt every test because the catalogue is truncated. */
let ids: Record<string, string> = {};

async function createProfiledUser() {
  const email = `srt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);

  const handle = `s_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, handle });
  if (profileError) throw profileError;

  return { id: data.user.id, handle };
}

/** One entry, with everything the sorts read set explicitly. */
async function collect(
  userId: string,
  title: string,
  {
    addedAt,
    listenedOn = null,
    rating = null,
  }: { addedAt: string; listenedOn?: string | null; rating?: number | null },
) {
  const { data, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: ids[title],
    p_listened_on: listenedOn ?? undefined,
  });
  if (error) throw error;

  // `added_at` defaults to now(), so every ordering case sets it explicitly
  // rather than relying on insertion order and clock resolution.
  const { error: updateError } = await admin
    .from('collection_entries')
    .update({ added_at: addedAt, rating })
    .eq('id', data!.id);
  if (updateError) throw updateError;
}

/**
 * The statement `listCollection` issues, verbatim, under one sort.
 *
 * The select string is kept identical to the service's on purpose. The order
 * clauses are not copied at all — they come from the module the service uses.
 */
async function readPage(
  client: SupabaseClient<Database>,
  userId: string,
  {
    sort = 'added',
    limit = 100,
    offset = 0,
  }: { sort?: CollectionSort; limit?: number; offset?: number } = {},
) {
  let query = client
    .from('collection_entries')
    .select(
      'id, album_id, rating, liked, relisten_count, albums(mbid, title, display_credit, artwork_status, first_release_date)',
      { count: 'exact' },
    )
    .eq('user_id', userId);

  for (const clause of collectionOrder(sort)) {
    query = query.order(clause.column, {
      ascending: clause.ascending,
      nullsFirst: clause.nullsFirst,
    });
  }

  const { data, count, error } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return { items: data ?? [], total: count ?? 0 };
}

/** Titles in the order the database returned them. */
async function titlesUnder(
  userId: string,
  sort: CollectionSort,
  client: SupabaseClient<Database> = admin,
) {
  const { items } = await readPage(client, userId, { sort });
  return items.map((row) => row.albums?.title);
}

/** A user holding all eight albums, added oldest-title-first so no two orders coincide. */
async function userWithEverything() {
  const user = await createProfiledUser();

  // Added in an order that matches none of the five other sorts, so a query
  // that quietly ignored its sort would fail every case rather than passing one
  // by coincidence.
  const addOrder = [
    'Sandinista!',
    'Now That’s What I Call Music! 100',
    'Undated Sessions',
    'In Rainbows',
    'Bootlegged Sessions',
    'Watch the Throne',
    'Acid Rap',
    'Unknown Pleasures',
  ];

  for (const [index, title] of addOrder.entries()) {
    await collect(user.id, title, {
      addedAt: `2026-01-0${index + 1}T12:00:00Z`,
    });
  }

  return { user, addOrder };
}

beforeAll(() => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing. Run `npm run db:env`.');
});

beforeEach(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');

  for (const payload of PAYLOADS) {
    await ingestReleaseGroupPayload(payload, admin);
  }

  const { data, error } = await admin.from('albums').select('id, title');
  if (error) throw error;

  ids = Object.fromEntries((data ?? []).map((album) => [album.title, album.id]));
  if (Object.keys(ids).length !== PAYLOADS.length) {
    throw new Error(`expected ${PAYLOADS.length} albums, got ${Object.keys(ids).length}`);
  }
});

afterAll(async () => {
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

// ---------------------------------------------------------------------------

describe('added', () => {
  it('returns the most recently added album first', async () => {
    const { user, addOrder } = await userWithEverything();

    expect(await titlesUnder(user.id, 'added')).toEqual([...addOrder].reverse());
  });

  it('is what an unsorted read returns, unchanged by this slice', async () => {
    // The overview passes no sort at all and must keep the ordering it had
    // before sorting existed.
    const { user, addOrder } = await userWithEverything();

    const { items } = await readPage(admin, user.id);
    expect(items.map((row) => row.albums?.title)).toEqual([...addOrder].reverse());
  });
});

describe('listened', () => {
  it('returns the most recent listen first and keeps undated listens last', async () => {
    const user = await createProfiledUser();

    await collect(user.id, 'In Rainbows', {
      addedAt: '2026-01-01T12:00:00Z',
      listenedOn: '1997-03-04',
    });
    await collect(user.id, 'Acid Rap', {
      addedAt: '2026-01-02T12:00:00Z',
      listenedOn: '2026-08-01',
    });
    await collect(user.id, 'Sandinista!', {
      addedAt: '2026-01-03T12:00:00Z',
      listenedOn: '2010-06-15',
    });
    // No listened_on at all. Not the oldest listen — no listen date.
    await collect(user.id, 'Watch the Throne', { addedAt: '2026-01-04T12:00:00Z' });

    expect(await titlesUnder(user.id, 'listened')).toEqual([
      'Acid Rap',
      'Sandinista!',
      'In Rainbows',
      'Watch the Throne',
    ]);
  });

  it('orders entries with no listen date among themselves by added_at descending', async () => {
    // Every null ties on the leading key, so the tiebreaker is the only thing
    // giving them an order at all.
    const user = await createProfiledUser();

    await collect(user.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z' });
    await collect(user.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z' });
    await collect(user.id, 'Sandinista!', { addedAt: '2026-01-03T12:00:00Z' });

    expect(await titlesUnder(user.id, 'listened')).toEqual([
      'Sandinista!',
      'Acid Rap',
      'In Rainbows',
    ]);
  });

  it('reorders under Listened, and leaves the default alone', async () => {
    // The load-bearing case. A backdated listen must be visible when asked for
    // and invisible otherwise — which is exactly what `coalesce(listened_on,
    // added_at)` could never offer.
    const user = await createProfiledUser();

    await collect(user.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z' });
    await collect(user.id, 'Acid Rap', {
      addedAt: '2026-01-02T12:00:00Z',
      listenedOn: '1997-03-04',
    });

    // Newest addition first, whatever the dates claim.
    expect(await titlesUnder(user.id, 'added')).toEqual(['Acid Rap', 'In Rainbows']);

    // A real 1997 listen outranks nothing at all only because null sorts last.
    expect(await titlesUnder(user.id, 'listened')).toEqual(['Acid Rap', 'In Rainbows']);

    // Backdate the *other* one further and the default still does not move.
    await admin
      .from('collection_entries')
      .update({ listened_on: '2026-08-20' })
      .eq('user_id', user.id)
      .eq('album_id', ids['In Rainbows']);

    expect(await titlesUnder(user.id, 'added')).toEqual(['Acid Rap', 'In Rainbows']);
    expect(await titlesUnder(user.id, 'listened')).toEqual(['In Rainbows', 'Acid Rap']);
  });
});

describe('rating', () => {
  it('returns the highest score first', async () => {
    const user = await createProfiledUser();

    await collect(user.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z', rating: 6.5 });
    await collect(user.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z', rating: 9.1 });
    await collect(user.id, 'Sandinista!', { addedAt: '2026-01-03T12:00:00Z', rating: 7.8 });

    expect(await titlesUnder(user.id, 'rating')).toEqual([
      'Acid Rap',
      'Sandinista!',
      'In Rainbows',
    ]);
  });

  it('treats 0.0 as the lowest real score, not as unrated', async () => {
    // The lowest score in the product is falsy, and every plausible shortcut in
    // an ordering turns it into "never rated" — which would sort it after the
    // genuinely unrated rows instead of before them.
    const user = await createProfiledUser();

    await collect(user.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z', rating: 0 });
    await collect(user.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z', rating: 4.2 });
    await collect(user.id, 'Sandinista!', { addedAt: '2026-01-03T12:00:00Z' });

    expect(await titlesUnder(user.id, 'rating')).toEqual([
      'Acid Rap',
      'In Rainbows',
      'Sandinista!',
    ]);
  });

  it('puts unrated albums last and keeps every one of them visible', async () => {
    // Decided 2026-08-21. Excluding them would be the reading of "unrated
    // entries are excluded from averages"; that rule is about aggregation, and
    // dropping rows here would hide albums from a collection.
    const { user } = await userWithEverything();

    await admin
      .from('collection_entries')
      .update({ rating: 8.4 })
      .eq('user_id', user.id)
      .eq('album_id', ids['Watch the Throne']);

    const titles = await titlesUnder(user.id, 'rating');

    expect(titles).toHaveLength(8);
    expect(titles[0]).toBe('Watch the Throne');
    expect(new Set(titles)).toEqual(new Set(Object.keys(ids)));
  });

  it('orders unrated entries among themselves by added_at descending', async () => {
    const user = await createProfiledUser();

    await collect(user.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z' });
    await collect(user.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z' });
    await collect(user.id, 'Sandinista!', { addedAt: '2026-01-03T12:00:00Z', rating: 5 });

    expect(await titlesUnder(user.id, 'rating')).toEqual([
      'Sandinista!',
      'Acid Rap',
      'In Rainbows',
    ]);
  });
});

describe('title', () => {
  it('sorts A-Z under the database collation', async () => {
    const { user } = await userWithEverything();

    expect(await titlesUnder(user.id, 'title')).toEqual([
      'Acid Rap',
      'Bootlegged Sessions',
      'In Rainbows',
      'Now That’s What I Call Music! 100',
      'Sandinista!',
      'Undated Sessions',
      'Unknown Pleasures',
      'Watch the Throne',
    ]);
  });

  it('places an undated album normally, because Title does not read the date', async () => {
    const { user } = await userWithEverything();
    const titles = await titlesUnder(user.id, 'title');

    expect(titles.indexOf('Undated Sessions')).toBe(5);
  });
});

describe('artist', () => {
  it('sorts A-Z by the album credit', async () => {
    // `display_credit`, not an artist's `sort_name` — decided 2026-08-21 — so
    // The Clash files under T and a joint credit files under its first name.
    const { user } = await userWithEverything();

    const { items } = await readPage(admin, user.id, { sort: 'artist' });

    expect(items.map((row) => row.albums?.display_credit)).toEqual([
      'Chance the Rapper',
      'Jay-Z & Kanye West',
      'Joy Division',
      'Radiohead',
      'Some Artist',
      'The Clash',
      'Various Artists',
      'Zephyr Quartet',
    ]);
  });

  it('breaks a shared credit on title before added_at', async () => {
    // Two albums under one credit should read alphabetically rather than by
    // whichever was added first.
    const user = await createProfiledUser();

    await admin
      .from('albums')
      .update({ display_credit: 'Radiohead' })
      .in('id', [ids['In Rainbows'], ids['Acid Rap'], ids['Sandinista!']]);

    await collect(user.id, 'Sandinista!', { addedAt: '2026-01-01T12:00:00Z' });
    await collect(user.id, 'In Rainbows', { addedAt: '2026-01-02T12:00:00Z' });
    await collect(user.id, 'Acid Rap', { addedAt: '2026-01-03T12:00:00Z' });

    expect(await titlesUnder(user.id, 'artist')).toEqual([
      'Acid Rap',
      'In Rainbows',
      'Sandinista!',
    ]);
  });
});

describe('year', () => {
  it('returns the most recent release first', async () => {
    const { user } = await userWithEverything();

    expect(await titlesUnder(user.id, 'year')).toEqual([
      'Now That’s What I Call Music! 100', // 2018
      'Acid Rap', //                          2013
      'Watch the Throne', //                  2011
      'In Rainbows', //                       2007
      'Bootlegged Sessions', //               1998
      'Sandinista!', //                       1980
      'Unknown Pleasures', //                 1979
      'Undated Sessions', //                  no date
    ]);
  });

  it('keeps an undated album last rather than floating it to the top', async () => {
    // Carried over from the artist page's locked rule: an undated release is
    // not the earliest one, it is one with no date.
    const user = await createProfiledUser();

    await collect(user.id, 'Undated Sessions', { addedAt: '2026-01-09T12:00:00Z' });
    await collect(user.id, 'Unknown Pleasures', { addedAt: '2026-01-01T12:00:00Z' });
    await collect(user.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z' });

    // Added most recently, so any ordering that ignored the date would lead
    // with it.
    expect(await titlesUnder(user.id, 'year')).toEqual([
      'Acid Rap',
      'Unknown Pleasures',
      'Undated Sessions',
    ]);
  });

  it('orders undated albums among themselves by added_at descending', async () => {
    const user = await createProfiledUser();

    await admin
      .from('albums')
      .update({ first_release_date: null, first_release_date_precision: null })
      .in('id', [ids['In Rainbows'], ids['Acid Rap']]);

    await collect(user.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z' });
    await collect(user.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z' });
    await collect(user.id, 'Sandinista!', { addedAt: '2026-01-03T12:00:00Z' });

    expect(await titlesUnder(user.id, 'year')).toEqual(['Sandinista!', 'Acid Rap', 'In Rainbows']);
  });
});

describe('paging a sorted collection', () => {
  const SORTS: CollectionSort[] = ['added', 'listened', 'rating', 'title', 'artist', 'year'];

  it('tiles every mode across pages without gaps or repeats', async () => {
    const { user } = await userWithEverything();

    for (const sort of SORTS) {
      const whole = await titlesUnder(user.id, sort);

      const paged: (string | undefined)[] = [];
      for (let offset = 0; offset < 8; offset += 3) {
        const { items } = await readPage(admin, user.id, { sort, limit: 3, offset });
        paged.push(...items.map((row) => row.albums?.title));
      }

      expect(paged, sort).toEqual(whole);
      expect(new Set(paged).size, sort).toBe(8);
    }
  });

  it('stays deterministic when every row ties on the leading key', async () => {
    // The tiebreaker's whole reason to exist. Eight albums on one rating have
    // no defined order without it, and a window over them can repeat a row on
    // two pages and drop another entirely.
    const { user } = await userWithEverything();

    await admin.from('collection_entries').update({ rating: 7 }).eq('user_id', user.id);

    const first = await titlesUnder(user.id, 'rating');

    const paged: (string | undefined)[] = [];
    for (let offset = 0; offset < 8; offset += 2) {
      const { items } = await readPage(admin, user.id, { sort: 'rating', limit: 2, offset });
      paged.push(...items.map((row) => row.albums?.title));
    }

    expect(paged).toEqual(first);
    expect(new Set(paged).size).toBe(8);
  });

  it('repeats the same order across identical reads', async () => {
    const { user } = await userWithEverything();

    for (const sort of SORTS) {
      const a = await titlesUnder(user.id, sort);
      const b = await titlesUnder(user.id, sort);
      expect(b, sort).toEqual(a);
    }
  });

  it('reports the whole collection count under every sort, not the window', async () => {
    const { user } = await userWithEverything();

    for (const sort of SORTS) {
      const { items, total } = await readPage(admin, user.id, { sort, limit: 3 });
      expect(total, sort).toBe(8);
      expect(items, sort).toHaveLength(3);
    }
  });
});

describe('sorting changes nothing about who sees what', () => {
  const SORTS: CollectionSort[] = ['added', 'listened', 'rating', 'title', 'artist', 'year'];

  it('returns only the requested user’s entries under every sort', async () => {
    const first = await createProfiledUser();
    const second = await createProfiledUser();

    await collect(first.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z', rating: 9.6 });
    await collect(first.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z' });

    // The same album in both collections — the case a query missing its
    // user_id filter would return identically for each.
    await collect(second.id, 'In Rainbows', { addedAt: '2026-01-03T12:00:00Z', rating: 1.2 });
    await collect(second.id, 'Sandinista!', { addedAt: '2026-01-04T12:00:00Z' });
    await collect(second.id, 'Watch the Throne', { addedAt: '2026-01-05T12:00:00Z' });

    for (const sort of SORTS) {
      const mine = await titlesUnder(first.id, sort);
      expect(mine, sort).toHaveLength(2);
      expect(new Set(mine), sort).toEqual(new Set(['In Rainbows', 'Acid Rap']));

      const theirs = await titlesUnder(second.id, sort);
      expect(theirs, sort).toHaveLength(3);
      expect(theirs, sort).not.toContain('Acid Rap');
    }
  });

  it('never leaks one user’s score into another’s ordering', async () => {
    const first = await createProfiledUser();
    const second = await createProfiledUser();

    await collect(first.id, 'In Rainbows', { addedAt: '2026-01-01T12:00:00Z', rating: 0 });
    await collect(first.id, 'Acid Rap', { addedAt: '2026-01-02T12:00:00Z', rating: 10 });

    // Reversed scores on the same two albums.
    await collect(second.id, 'In Rainbows', { addedAt: '2026-01-03T12:00:00Z', rating: 10 });
    await collect(second.id, 'Acid Rap', { addedAt: '2026-01-04T12:00:00Z', rating: 0 });

    expect(await titlesUnder(first.id, 'rating')).toEqual(['Acid Rap', 'In Rainbows']);
    expect(await titlesUnder(second.id, 'rating')).toEqual(['In Rainbows', 'Acid Rap']);
  });

  it('is readable signed out under every sort, count included', async () => {
    // Everything user-generated is public, and sorting is a read — so an
    // anonymous client gets the same rows in the same order. Decided
    // 2026-08-21: there is no owner-only condition anywhere on this surface.
    const { user } = await userWithEverything();

    for (const sort of SORTS) {
      const asOwner = await titlesUnder(user.id, sort);
      const asVisitor = await titlesUnder(user.id, sort, anon);

      expect(asVisitor, sort).toEqual(asOwner);

      const { total } = await readPage(anon, user.id, { sort });
      expect(total, sort).toBe(8);
    }
  });
});
