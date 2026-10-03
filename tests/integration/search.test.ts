import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { ALBUM_SUMMARY_COLUMNS } from '@/services/catalogue/queries';

/**
 * Search ranking.
 *
 * Built on purpose-made rows rather than the shared fixtures: the ordering
 * rules only mean something when several albums genuinely compete for the same
 * query, which the fixtures do not do.
 *
 * The popularity values here are arbitrary and exist solely to establish an
 * order. No weights are being tuned — the ranking is tiered, so there are no
 * weights to tune.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * A signed-out client. Used only by the alias tests at the foot of this file,
 * where the question is whether `anon` can read `artist_aliases` at all - the
 * rest of this file reads through `admin` because ranking is the subject.
 */
const anon: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const A = (n: number) => `0b0e4f1e-5555-4000-8000-${String(n).padStart(12, '0')}`;

const ALBUMS = [
  // Two albums titled exactly "Blonde" — the ambiguous case popularity exists
  // to resolve. The obscure one is deliberately listed first.
  { mbid: A(1), title: 'Blonde', display_credit: 'Some Obscure Band', popularity_score: 5 },
  { mbid: A(2), title: 'Blonde', display_credit: 'Frank Ocean', popularity_score: 9000 },
  // Shares the word but is not an exact match.
  { mbid: A(3), title: 'Blonde on Blonde', display_credit: 'Bob Dylan', popularity_score: 8000 },
  // Hugely popular, unrelated text. Must never surface for "blonde".
  { mbid: A(4), title: 'Thriller', display_credit: 'Michael Jackson', popularity_score: 100000 },
  // Exact title match with no popularity at all.
  { mbid: A(5), title: 'Quiet Record', display_credit: 'Nobody', popularity_score: null },
  // Very popular album by an artist whose name is a query in its own right.
  { mbid: A(6), title: 'Kid A', display_credit: 'Radiohead', popularity_score: 7000 },
  { mbid: A(7), title: 'Amnesiac', display_credit: 'Radiohead', popularity_score: 3000 },

  // Article-leading artists and titles. These exist because the fuzzy tier's
  // measured defect is trigram inflation from a shared leading article — with
  // no "The …" artist in the corpus the collision cannot be reproduced at all.
  // Titles and credits mirror real catalogue rows so the similarity values the
  // decision rests on (`docs/architecture.md` §10) are the ones under test.
  { mbid: A(8), title: 'The Warning', display_credit: 'Hot Chip', popularity_score: 400 },
  { mbid: A(9), title: 'The Wall', display_credit: 'Pink Floyd', popularity_score: 9000 },
  { mbid: A(10), title: 'Harmony', display_credit: 'The Wake', popularity_score: 10 },
  { mbid: A(11), title: 'Assembly', display_credit: 'The Wake', popularity_score: 8 },
  { mbid: A(12), title: 'Who’s Next', display_credit: 'The Who', popularity_score: 5000 },
  { mbid: A(13), title: 'Americana', display_credit: 'The Offspring', popularity_score: 3000 },
  { mbid: A(14), title: 'Starboy', display_credit: 'The Weeknd', popularity_score: 8000 },
  { mbid: A(15), title: 'xx', display_credit: 'The xx', popularity_score: 2000 },
  { mbid: A(16), title: 'London Calling', display_credit: 'The Clash', popularity_score: 6000 },

  // Ordinary partial-artist prefixes. Each of these scores exactly 0.500
  // against its own credit, which is why the rejected `> 0.5` threshold would
  // have lost every one of them.
  { mbid: A(17), title: 'AM', display_credit: 'Arctic Monkeys', popularity_score: 7000 },
  { mbid: A(18), title: 'GUTS', display_credit: 'Olivia Rodrigo', popularity_score: 7500 },
  { mbid: A(19), title: 'Evolve', display_credit: 'Imagine Dragons', popularity_score: 6500 },
  { mbid: A(20), title: 'The Fragile', display_credit: 'Nine Inch Nails', popularity_score: 4000 },
];

/** Artists, seeded only for `search_artists`. Albums above are independent. */
const ARTISTS = [
  { mbid: A(101), name: 'The Wake', sort_name: 'Wake, The' },
  { mbid: A(102), name: 'The Weeknd', sort_name: 'Weeknd, The' },
  { mbid: A(103), name: 'The Who', sort_name: 'Who, The' },
  { mbid: A(104), name: 'The xx', sort_name: 'xx, The' },
  { mbid: A(105), name: 'Pink Floyd', sort_name: 'Pink Floyd' },
  { mbid: A(106), name: 'Radiohead', sort_name: 'Radiohead' },
];

async function seed() {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');

  const { error: artistError } = await admin.from('artists').insert(ARTISTS);
  if (artistError) throw artistError;

  const { error } = await admin.from('albums').insert(
    ALBUMS.map((a) => ({
      ...a,
      primary_type: 'album' as const,
      first_release_date: '2000-01-01',
      first_release_date_precision: 'year' as const,
    })),
  );
  if (error) throw error;
}

async function search(query: string, limit = 20) {
  const { data, error } = await admin.rpc('search_albums', { query, max_results: limit });
  if (error) throw error;
  return data ?? [];
}

beforeAll(seed);
afterAll(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('search_albums — text relevance is primary', () => {
  it('puts an exact title match above a partial one, regardless of popularity', async () => {
    const results = await search('blonde');

    // "Blonde on Blonde" is popular and contains the word, but the exact
    // matches must come first.
    const titles = results.map((r) => r.title);
    expect(titles.slice(0, 2)).toEqual(['Blonde', 'Blonde']);
    expect(titles).toContain('Blonde on Blonde');
    expect(titles.indexOf('Blonde on Blonde')).toBeGreaterThan(1);
  });

  it('ranks an unpopular exact match above a far more popular partial match', async () => {
    const results = await search('blonde');
    const obscure = results.findIndex((r) => r.display_credit === 'Some Obscure Band');
    const dylan = results.findIndex((r) => r.title === 'Blonde on Blonde');

    // Popularity 5 versus 8000. Text relevance still wins.
    expect(obscure).toBeLessThan(dylan);
  });

  it('never surfaces a popular album that does not match the text', async () => {
    const results = await search('blonde');
    expect(results.map((r) => r.title)).not.toContain('Thriller');
  });

  it('finds an exact match that has no popularity score at all', async () => {
    const results = await search('quiet record');
    expect(results[0]?.title).toBe('Quiet Record');
    expect(results[0]?.popularity_score).toBeNull();
  });
});

describe('search_albums — popularity disambiguates', () => {
  it('orders equally-relevant titles by popularity', async () => {
    const results = await search('blonde');
    const exact = results.filter((r) => r.title === 'Blonde');

    // Both are exact title matches and tie on text, so popularity decides —
    // the one role it should play.
    expect(exact).toHaveLength(2);
    expect(exact[0].display_credit).toBe('Frank Ocean');
    expect(exact[1].display_credit).toBe('Some Obscure Band');
  });

  it('orders an artist’s catalogue by popularity when relevance is equal', async () => {
    const results = await search('radiohead');
    const credits = results.map((r) => r.title);
    expect(credits.slice(0, 2)).toEqual(['Kid A', 'Amnesiac']);
  });
});

describe('search_albums — artist matching', () => {
  it('finds albums by an exact artist name', async () => {
    const results = await search('frank ocean');
    expect(results[0]?.display_credit).toBe('Frank Ocean');
  });

  it('is case insensitive', async () => {
    const upper = await search('BLONDE');
    const lower = await search('blonde');
    expect(upper.map((r) => r.mbid)).toEqual(lower.map((r) => r.mbid));
  });
});

describe('search_albums — robustness', () => {
  it('tolerates a typo through trigram matching', async () => {
    const results = await search('thriler');
    expect(results.map((r) => r.title)).toContain('Thriller');
  });

  it('returns nothing for an empty or whitespace query', async () => {
    expect(await search('')).toEqual([]);
    expect(await search('   ')).toEqual([]);
  });

  it('returns nothing for a query matching nothing', async () => {
    expect(await search('zzzzzzzz nonexistent')).toEqual([]);
  });

  it('respects the result limit', async () => {
    expect((await search('blonde', 1)).length).toBe(1);
  });

  it('is not confused by punctuation', async () => {
    const results = await search('kid a!');
    expect(results.map((r) => r.title)).toContain('Kid A');
  });
});

/**
 * Article normalisation in the fuzzy operands (`docs/architecture.md` §10).
 *
 * A leading `the`/`a`/`an` is stripped from **both** sides of the fuzzy
 * similarity comparison before it runs. The threshold stays at `> 0.3`;
 * raising it was measured across 883 queries and rejected, because ordinary
 * prefixes like `arctic m` score exactly 0.500 and would all have been lost.
 *
 * These assert identity and rank rather than row counts, because the defect is
 * *which* albums appear, not how many.
 */
describe('search_albums — article normalisation', () => {
  const credits = async (q: string, limit = 20) =>
    (await search(q, limit)).map((r) => r.display_credit);
  const titles = async (q: string, limit = 20) => (await search(q, limit)).map((r) => r.title);

  describe('partial artist names still reach their albums', () => {
    // Each scores exactly 0.500 against its own credit. The rejected `> 0.5`
    // threshold excluded all five; `radioh` at 0.545 survived it, which is
    // precisely why `radioh` alone was insufficient protection.
    it.each([
      ['michael ', 'Michael Jackson', 'Thriller'],
      ['arctic m', 'Arctic Monkeys', 'AM'],
      ['olivia r', 'Olivia Rodrigo', 'GUTS'],
      ['imagine ', 'Imagine Dragons', 'Evolve'],
      ['nine inc', 'Nine Inch Nails', 'The Fragile'],
      ['radioh', 'Radiohead', 'Kid A'],
    ])('%s finds %s', async (query, credit, title) => {
      const results = await search(query);
      expect(results.map((r) => r.display_credit)).toContain(credit);
      expect(results.map((r) => r.title)).toContain(title);
    });
  });

  describe('article-leading queries lose their collision noise', () => {
    it('the warning ranks The Warning first and drops the article collisions', async () => {
      const results = await search('the warning');

      expect(results[0]?.title).toBe('The Warning');
      expect(results[0]?.display_credit).toBe('Hot Chip');

      // Measured collisions: similarity('The Wake','the warning') was 0.400,
      // 'The Who' 0.333 and 'The Offspring' 0.300 — all over the threshold
      // purely through the shared article. Normalised they fall to ≤0.182.
      const credits = results.map((r) => r.display_credit);
      expect(credits).not.toContain('The Wake');
      expect(credits).not.toContain('The Who');
      expect(credits).not.toContain('The Offspring');
    });

    it('the wall ranks The Wall first and drops the article collisions', async () => {
      const results = await search('the wall');

      expect(results[0]?.title).toBe('The Wall');
      expect(results[0]?.display_credit).toBe('Pink Floyd');

      const credits = results.map((r) => r.display_credit);
      expect(credits).not.toContain('The Wake');
      expect(credits).not.toContain('The Weeknd');
      expect(credits).not.toContain('The xx');
    });
  });

  describe('over-correction guards', () => {
    it('the wake still returns The Wake’s own albums', async () => {
      // The whole risk of this change: silencing noise by silencing the artist.
      expect(await titles('the wake')).toEqual(expect.arrayContaining(['Harmony', 'Assembly']));
    });

    it('a non-article partial prefix is unaffected', async () => {
      expect(await credits('arctic m')).toContain('Arctic Monkeys');
    });
  });

  describe('the accepted recall loss, encoded deliberately', () => {
    /**
     * **This is a product decision, not a regression.** `docs/architecture.md`
     * §10 accepts ~5 points of partial-prefix album recall to remove
     * article-driven noise. `the we` is the documented case: normalised,
     * `similarity('Weeknd','we')` is 0.250, so The Weeknd's albums leave the
     * fuzzy tier — along with The xx and The Clash, which were noise.
     *
     * If this test starts failing because Starboy reappears, the normalisation
     * has been removed. If it fails because The Weeknd is no longer findable at
     * all, the compensating artist path has broken — which is the part that
     * makes the tradeoff acceptable.
     */
    it('the we loses The Weeknd’s albums but not The Weeknd', async () => {
      expect(await credits('the we')).not.toContain('The Weeknd');

      const { data, error } = await admin.rpc('search_artists', {
        query: 'the we',
        max_results: 5,
      });
      if (error) throw error;
      expect((data ?? []).map((a) => a.name)).toContain('The Weeknd');
    });
  });
});

describe('search_artists', () => {
  it('ranks an exact artist name first', async () => {
    const { data, error } = await admin.rpc('search_artists', {
      query: 'radiohead',
      max_results: 5,
    });
    if (error) throw error;
    expect(Array.isArray(data)).toBe(true);
    expect((data ?? [])[0]?.name).toBe('Radiohead');
  });

  it('the wall no longer returns unrelated “The …” artists', async () => {
    // The same article-inflation mechanism as the album credit predicate, and
    // justified on its own evidence: this query returned The Wake, The Weeknd,
    // The Who and The xx, none of them relevant.
    const { data, error } = await admin.rpc('search_artists', {
      query: 'the wall',
      max_results: 10,
    });
    if (error) throw error;

    const names = (data ?? []).map((a) => a.name);
    expect(names).not.toContain('The Wake');
    expect(names).not.toContain('The Weeknd');
    expect(names).not.toContain('The Who');
    expect(names).not.toContain('The xx');
  });

  it('an exact artist name still outranks a prefix match', async () => {
    const { data, error } = await admin.rpc('search_artists', {
      query: 'the who',
      max_results: 5,
    });
    if (error) throw error;
    expect((data ?? [])[0]?.name).toBe('The Who');
  });
});

/**
 * The credited-artist aggregate (`architecture.md` §16.8).
 *
 * **The corpus above deliberately creates no `album_artists` rows** — every
 * other assertion in this file is about text relevance, which reads only
 * `albums`. So the aggregate has to build its own links, and the empty case is
 * genuinely the default rather than a contrived one.
 *
 * **What is asserted here is the function's contract, not the product rule.**
 * Whether a pseudo-artist is linkable is decided in `credit.ts` and tested in
 * `credit.test.ts`; the database's job is to return every credited artist, in
 * credit order, in the shape the PostgREST embed also returns.
 */
describe('search_albums — credited artists', () => {
  async function albumIdFor(mbid: string) {
    const { data } = await admin.from('albums').select('id').eq('mbid', mbid).single();
    if (!data) throw new Error(`album ${mbid} not seeded`);
    return data.id;
  }

  async function artistIdFor(mbid: string) {
    const { data } = await admin.from('artists').select('id').eq('mbid', mbid).single();
    if (!data) throw new Error(`artist ${mbid} not seeded`);
    return data.id;
  }

  beforeAll(async () => {
    const kidA = await albumIdFor(A(6));
    const radiohead = await artistIdFor(A(106));
    const theWake = await artistIdFor(A(101));

    // Inserted with the later position first, so a passing order assertion
    // proves the aggregate orders rather than that insertion happened to.
    const { error } = await admin.from('album_artists').insert([
      { album_id: kidA, artist_id: theWake, position: 1 },
      { album_id: kidA, artist_id: radiohead, position: 0 },
    ]);
    if (error) throw error;
  });

  it('returns an empty array for an album with no credited artists', async () => {
    const [thriller] = await search('Thriller');

    // `[]` and not null: the caller must never have to tell "no rows" apart
    // from "no column". `display_credit` stays the fallback for this case.
    expect(thriller.artists).toEqual([]);
  });

  it('returns credited artists in credit order, not insertion order', async () => {
    const [kidA] = await search('Kid A');
    const credited = kidA.artists as { position: number; artists: { name: string } }[];

    expect(credited.map((row) => row.artists.name)).toEqual(['Radiohead', 'The Wake']);
    expect(credited.map((row) => row.position)).toEqual([0, 1]);
  });

  it('returns the shape the PostgREST embed returns, so one mapper serves both', async () => {
    // **Compared against the embed itself, not against a literal.** The literal
    // this replaced said `['id', 'mbid', 'name']`, which meant the test could
    // only fail when the aggregate changed — including when it changed to match
    // the embed, which is what happened when both gained `slug`. Reading the
    // real column list makes it fail on divergence, which is what it is for.
    const [kidA] = await search('Kid A');
    const [fromRpc] = kidA.artists as { position: number; artists: Record<string, unknown> }[];

    const { data: embedded, error } = await admin
      .from('albums')
      .select(ALBUM_SUMMARY_COLUMNS)
      .eq('mbid', A(6))
      .single();
    if (error) throw error;

    const [fromEmbed] = embedded.album_artists as unknown as {
      position: number;
      artists: Record<string, unknown>;
    }[];

    expect(Object.keys(fromRpc).sort()).toEqual(Object.keys(fromEmbed).sort());
    expect(Object.keys(fromRpc.artists).sort()).toEqual(Object.keys(fromEmbed.artists).sort());
  });
});

/**
 * The phonetic fallback — F-019's second lever, `architecture.md` §10.4.
 *
 * **The load-bearing assertion is the negative one.** Adding a tier that only
 * fires on an empty result set is only safe if it genuinely cannot touch a
 * non-empty one, and that is a property of the `if not found` branch rather
 * than of the phonetic predicate.
 *
 * **The measurement that justified this is in §10.4 and corrected the
 * entry's premise.** F-019 argues from `smith`/`smyth`, whose trigram
 * similarity is 0.333 — already above the threshold. The real win is consonant
 * substitution: `radiohead`/`radeeohed` is 0.250 and phonetically identical.
 */
describe('phonetic fallback for artist search', () => {
  it('leaves an exact match alone', async () => {
    const { data, error } = await admin.rpc('search_artists', { query: 'Radiohead' });
    expect(error).toBeNull();
    expect(data![0].name).toBe('Radiohead');
    expect(data![0].tier).toBe(1);
  });

  it('leaves a typo the existing tiers already reach alone', async () => {
    // Trigram similarity 0.583, so this was always tier 4 and must stay there.
    const { data } = await admin.rpc('search_artists', { query: 'Radiohed' });
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((row) => row.tier < 5)).toBe(true);
  });

  it('rescues a query the existing tiers miss, at tier 5', async () => {
    // **Trigram 0.250 — below the 0.3 threshold — and phonetically identical.**
    // This returned nothing before the fallback existed.
    const { data, error } = await admin.rpc('search_artists', { query: 'Radeeohed' });
    expect(error).toBeNull();
    expect(data!.map((row) => row.name)).toContain('Radiohead');
    expect(data!.find((row) => row.name === 'Radiohead')!.tier).toBe(5);
  });

  it('never mixes a phonetic match into a result set that already had rows', async () => {
    // **The guarantee, asserted directly.** Any query reaching tiers 1–4 must
    // come back with no tier-5 row at all — not merely with tier 5 ranked last.
    // **The suite's own fixtures, not the global ones.** This file seeds its
    // artists in `beforeAll` and an earlier draft used names from the fixture
    // catalogue instead — which returned zero rows and failed on the wrong
    // assertion.
    for (const query of ['Radiohead', 'Radiohed', 'Pink Floyd', 'The Who']) {
      const { data } = await admin.rpc('search_artists', { query });
      expect(data!.length).toBeGreaterThan(0);
      expect(data!.some((row) => row.tier === 5)).toBe(false);
    }
  });

  it('still returns nothing for a query that is not a misspelling of anything', async () => {
    const { data } = await admin.rpc('search_artists', { query: 'zzzqqqxxx' });
    expect(data).toEqual([]);
  });

  it('does not rescue a one or two character query', async () => {
    /*
     * **Reasoned, and not demonstrable on this catalogue** — stated rather than
     * implied. `dmetaphone` of a very short string matches a great many names,
     * so the fallback is guarded at three characters; but the eight fixture
     * artists produce **no** short-string phonetic collision, so this asserts
     * the guard's effect rather than observing it rescue-then-stop. A catalogue
     * where `zq` matched something would make it a real test.
     */
    const { data } = await admin.rpc('search_artists', { query: 'zq' });
    expect(data).toEqual([]);
  });
});

/**
 * Alias matching - F-019, `architecture.md` 10.5.
 *
 * **The assertion that matters is the count.** An artist with several matching
 * aliases must appear once, with its real `album_count` - a naive join
 * multiplies both, and that reads as a ranking problem rather than a counting
 * one.
 */
describe('artist aliases widen search', () => {
  const RADIOHEAD = A(106);
  let artistId = '';

  beforeAll(async () => {
    const { data } = await admin.from('artists').select('id').eq('mbid', RADIOHEAD).single();
    artistId = data!.id;

    await admin.from('artist_aliases').delete().eq('artist_id', artistId);
    const { error } = await admin.from('artist_aliases').insert([
      { artist_id: artistId, name: 'On a Friday', kind: 'artist_name', locale: 'en' },
      { artist_id: artistId, name: 'Radio Head', kind: 'search_hint' },
      { artist_id: artistId, name: 'Radiohed', kind: 'search_hint' },
    ]);
    if (error) throw error;
  });

  afterAll(async () => {
    if (artistId) await admin.from('artist_aliases').delete().eq('artist_id', artistId);
  });

  it('reaches an artist by a former name it never held in `name`', async () => {
    const { data, error } = await admin.rpc('search_artists', { query: 'On a Friday' });
    expect(error).toBeNull();
    expect(data!.map((row) => row.name)).toContain('Radiohead');
  });

  it('ranks an exact alias at tier 2, below an exact name and above the fuzzy tiers', async () => {
    const { data } = await admin.rpc('search_artists', { query: 'On a Friday' });
    expect(data!.find((row) => row.name === 'Radiohead')!.tier).toBe(2);
  });

  it('reaches it by a curated misspelling', async () => {
    // `Radiohed` stands in for `Kayne West` - a Search hint that exists because
    // somebody typed it wrong often enough to be worth recording upstream.
    const { data } = await admin.rpc('search_artists', { query: 'Radiohed' });
    expect(data!.map((row) => row.name)).toContain('Radiohead');
  });

  it('does not multiply album_count by the number of matching aliases', async () => {
    // **The bug the CTE exists to prevent.** Three aliases match `Radio`; a
    // naive join would report three times the albums and three rows.
    const { count: real } = await admin
      .from('album_artists')
      .select('album_id', { count: 'exact', head: true })
      .eq('artist_id', artistId);

    const { data } = await admin.rpc('search_artists', { query: 'Radio' });
    const rows = data!.filter((row) => row.name === 'Radiohead');

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].album_count)).toBe(real);
  });

  it('still gives the canonical name tier 1 when it matches exactly', async () => {
    // Aliases must never outrank the real thing.
    const { data } = await admin.rpc('search_artists', { query: 'Radiohead' });
    expect(data![0].name).toBe('Radiohead');
    expect(data![0].tier).toBe(1);
  });

  it('matches nothing for a query unlike every name and alias', async () => {
    const { data } = await admin.rpc('search_artists', { query: 'zzqqxx' });
    expect(data).toEqual([]);
  });

  it('lets a signed-out visitor match on an alias', async () => {
    // Search is a signed-out surface, and the function is `stable` so it runs
    // as its caller - without the `anon` select grant on `artist_aliases` an
    // alias match would silently return nothing for exactly the visitors most
    // likely to be guessing at a spelling.
    const { data, error } = await anon.rpc('search_artists', { query: 'On a Friday' });
    expect(error).toBeNull();
    expect(data!.map((row) => row.name)).toContain('Radiohead');
  });
});
