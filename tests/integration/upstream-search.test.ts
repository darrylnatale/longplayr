import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as adminModule from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import type { MbReleaseGroup } from '@/services/catalogue/musicbrainz';
import { searchUpstream } from '@/services/catalogue/self-service';

/**
 * Upstream search reach — `product-spec.md` §8.10, `[DECIDED 2026-09-06]`.
 *
 * **The first coverage `searchUpstream` has ever had**, and it exists because
 * the function's defect was invisible from its output. It asked MusicBrainz for
 * `limit * 2` release groups — ten, at the panel's display limit of five — then
 * filtered that pool twice before showing anything: once through the scope
 * filter, once to remove everything the catalogue already holds. A user seeing
 * four results was seeing filtering, not upstream supply.
 *
 * **Why this is an integration test rather than a unit one.** The pipeline has
 * two external dependencies and only one can be honestly faked. MusicBrainz is
 * stubbed at `fetch`. The already-held filter is a real PostgREST `.in()`
 * against `albums`, and mocking a query builder would mean asserting against a
 * fake instead of against the filter. So the catalogue half runs for real.
 *
 * **No live MusicBrainz request is made.** The stub intercepts before the
 * network, exactly as `jobs.test.ts` does for Cover Art Archive, and
 * `MUSICBRAINZ_CONTACT` is set and restored the way `musicbrainz.test.ts`
 * established. The rate limiter is deliberately **not** mocked: it is on the
 * path under test, and its real pacing is what this costs.
 */

/**
 * The real rate limiter and the real retry policy are both on the path under
 * test, and neither is mocked, so these tests are legitimately slow: pacing is
 * 0.9 req/s, and the unreachable-MusicBrainz case takes three attempts with 2s
 * and 4s between them — around eight seconds for that one test alone. 15s
 * covers it with room to spare. Raised here rather than on the project so every
 * other integration file keeps the tight 5s budget.
 */
vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * The contact guard refuses live calls with a placeholder, which is why the
 * panel never populates in any other suite. A real-looking value lets the
 * request reach the stub; the original is put back after every test.
 */
const originalContact = process.env.MUSICBRAINZ_CONTACT;

// ---------------------------------------------------------------------------
// The starvation fixture
// ---------------------------------------------------------------------------

/**
 * Twenty-five release groups, ordered so that fetch depth alone decides whether
 * the panel can show anything:
 *
 * | Positions | Contents                      | Removed by            |
 * | --------- | ----------------------------- | --------------------- |
 * | 1–8       | `Single`                      | `classify().inScope`  |
 * | 9–10      | `Album`, seeded into `albums` | the already-held filter |
 * | 11–25     | `Album`, not held             | nothing — 15 survive  |
 *
 * **The arithmetic is the point.** At the old depth of ten the response stops
 * at position 10, so eight singles and two held records leave **zero**
 * survivors and the panel shows nothing. At twenty-five, fifteen survive and
 * ten are displayed. The stub honours the requested `limit` precisely so that
 * distinction is real — a fixed array would let the old implementation pass.
 *
 * It is not a contrived shape: §8.10 records the observed failure as a page of
 * already-held records crowding out the record being looked for.
 */
const SINGLES = 8;
const HELD = 2;
const TOTAL = 25;

/** Deterministic, and distinct from anything the fixture catalogue holds. */
function mbid(position: number): string {
  return `1a2b3c4d-0001-4000-8000-${String(position).padStart(12, '0')}`;
}

/**
 * `score` runs *ascending* while array order runs descending in relevance —
 * deliberately adversarial, so any implementation that sorted by Lucene score
 * would return this list reversed.
 */
function group(position: number, singles = SINGLES): MbReleaseGroup & { score: number } {
  const single = position <= singles;
  return {
    id: mbid(position),
    title: `Candidate ${position}`,
    'primary-type': single ? 'Single' : 'Album',
    'first-release-date': `20${String(position).padStart(2, '0')}-05-01`,
    'artist-credit': [{ name: `Artist ${position}` }],
    score: position,
  } as MbReleaseGroup & { score: number };
}

const FIXTURE = Array.from({ length: TOTAL }, (_, index) => group(index + 1));

/** Positions 9 and 10 — in scope upstream, already in our catalogue. */
const HELD_POSITIONS = Array.from({ length: HELD }, (_, index) => SINGLES + index + 1);
/** Positions 11–25 — the only entries that survive both filters. */
const SURVIVOR_POSITIONS = Array.from(
  { length: TOTAL - SINGLES - HELD },
  (_, index) => SINGLES + HELD + index + 1,
);

/**
 * A second fixture, and the only one that can tell the old implementation from
 * the new.
 *
 * **The standard fixture above cannot do it, which is why this exists.** With
 * `limit * 2`, a display limit of ten fetched twenty — deep enough to clear the
 * eight singles and two held records and return the same ten results the new
 * code returns. It would have passed against the very implementation it was
 * meant to catch.
 *
 * Here the removable block runs to **twenty**: eighteen singles, then the two
 * held records, leaving five free records at positions 21–25.
 *
 * | Implementation           | Fetches | Survivors |
 * | ------------------------ | ------- | --------- |
 * | `limit * 2` at limit 5   | 10      | **0**     |
 * | `limit * 2` at limit 10  | 20      | **0**     |
 * | fixed depth of 25        | 25      | **5**     |
 *
 * Nothing short of twenty-one reaches a single usable record, so this test
 * fails against the old coupling at every display limit the panel has ever
 * used.
 */
const DEEP_SINGLES = 18;
const STARVATION = Array.from({ length: TOTAL }, (_, index) => group(index + 1, DEEP_SINGLES));
const DEEP_HELD_POSITIONS = Array.from({ length: HELD }, (_, index) => DEEP_SINGLES + index + 1);
const DEEP_SURVIVOR_POSITIONS = Array.from(
  { length: TOTAL - DEEP_SINGLES - HELD },
  (_, index) => DEEP_SINGLES + HELD + index + 1,
);

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/**
 * Intercepts MusicBrainz and lets everything else through.
 *
 * **The pass-through is mandatory, not tidiness.** Integration tests reach
 * local Supabase over `fetch`, so a blanket stub would break every database
 * call in this file. Same shape as `stubCoverArt` in `jobs.test.ts`.
 *
 * **It honours the requested `limit`.** That is what makes the starvation test
 * a regression test: ask for ten and you get positions 1–10 and nothing else.
 */
function stubMusicBrainz(groups: (MbReleaseGroup & { score?: number })[]) {
  const requested: number[] = [];
  const realFetch = globalThis.fetch.bind(globalThis);

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const target = typeof input === 'string' ? input : input.toString();
    if (!target.includes('musicbrainz.org')) {
      return realFetch(input as RequestInfo, init);
    }

    const url = new URL(target);
    const limit = Number(url.searchParams.get('limit'));

    /*
     * **Only the release-group search is recorded.** `searchUpstream` also
     * probes the artist index now (`architecture.md` §7.5), and these tests are
     * about release-group *fetch depth* — counting the artist probe's own limit
     * here would make the depth assertions below say something they do not
     * mean. The artist path is inert under this stub anyway: it answers every
     * path with `release-groups`, so the artist search finds no `artists` key
     * and gives up without browsing.
     */
    if (!url.pathname.endsWith('/artist')) requested.push(limit);

    return new Response(JSON.stringify({ 'release-groups': groups.slice(0, limit), count: 312 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { requested };
}

/** Makes the MusicBrainz call fail while leaving Supabase reachable. */
function stubMusicBrainzFailure() {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const target = typeof input === 'string' ? input : input.toString();
    if (!target.includes('musicbrainz.org')) {
      return realFetch(input as RequestInfo, init);
    }
    throw new Error('network unreachable');
  });
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

async function clearCatalogue() {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
}

/** Puts positions 9 and 10 in the catalogue, so the held filter has work to do. */
async function seedHeld(positions: number[] = HELD_POSITIONS) {
  const { error } = await admin.from('albums').insert(
    positions.map((position) => ({
      mbid: mbid(position),
      title: `Candidate ${position}`,
      display_credit: `Artist ${position}`,
      primary_type: 'album' as const,
    })),
  );
  if (error) throw error;
}

beforeEach(async () => {
  process.env.MUSICBRAINZ_CONTACT = 'https://github.com/darrylnatale/longplayr';
  await clearCatalogue();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalContact === undefined) delete process.env.MUSICBRAINZ_CONTACT;
  else process.env.MUSICBRAINZ_CONTACT = originalContact;
});

afterAll(clearCatalogue);

// ---------------------------------------------------------------------------

describe('upstream fetch depth', () => {
  it('asks MusicBrainz for 25 release groups', async () => {
    const mb = stubMusicBrainz(FIXTURE);
    await seedHeld();

    await searchUpstream('candidate');

    expect(mb.requested).toEqual([25]);
  });

  it('does not vary with the display limit', async () => {
    // The whole substance of the decision: `limit` caps survivors and has no
    // bearing on retrieval. Asserted across two very different display limits.
    const mb = stubMusicBrainz(FIXTURE);
    await seedHeld();

    const few = await searchUpstream('candidate', 3);
    const many = await searchUpstream('candidate', 20);

    expect(mb.requested).toEqual([25, 25]);
    expect(few).toHaveLength(3);
    expect(many).toHaveLength(15);
  });
});

describe('the filters between the fetch and the display', () => {
  it('removes out-of-scope release groups', async () => {
    const singles = FIXTURE.slice(0, SINGLES).map((entry) => entry.id);
    stubMusicBrainz(FIXTURE);
    await seedHeld();

    const results = await searchUpstream('candidate', 25);
    const returned = results.map((entry) => entry.mbid);

    for (const id of singles) {
      expect(returned).not.toContain(id);
    }
    // The singles were in the response and are not in the output, which is the
    // filter working rather than them never having arrived.
    expect(returned).toHaveLength(SURVIVOR_POSITIONS.length);
  });

  it('removes records the catalogue already holds', async () => {
    stubMusicBrainz(FIXTURE);
    await seedHeld();

    const results = await searchUpstream('candidate', 25);

    for (const position of HELD_POSITIONS) {
      expect(results.map((entry) => entry.mbid)).not.toContain(mbid(position));
    }
    // Asserted rather than assumed: without the seed the two would have
    // survived, so this proves the filter ran rather than that they were absent.
    expect(results).toHaveLength(SURVIVOR_POSITIONS.length);
  });

  it('slices the survivors to the display limit rather than to the fetch depth', async () => {
    stubMusicBrainz(FIXTURE);
    await seedHeld();

    const results = await searchUpstream('candidate', 10);

    expect(results).toHaveLength(10);
  });
});

describe('the starvation case this change exists for', () => {
  it('reaches records no coupled fetch depth could have shown', async () => {
    // **The regression assertion.** Twenty of the twenty-five entries are
    // removable, so nothing usable exists before position 21. The old
    // `limit * 2` fetched ten at the panel's original display limit and twenty
    // at its new one, and **both return nothing here**. Only a fixed depth of
    // twenty-five reaches the five free records.
    //
    // The stub honours the requested limit, which is what makes that true
    // rather than merely stated.
    stubMusicBrainz(STARVATION);
    await seedHeld(DEEP_HELD_POSITIONS);

    const results = await searchUpstream('candidate', 10);

    expect(results).toHaveLength(DEEP_SURVIVOR_POSITIONS.length);
    expect(results.map((entry) => entry.mbid)).toEqual(
      DEEP_SURVIVOR_POSITIONS.map((position) => mbid(position)),
    );
    expect(results[0].title).toBe(`Candidate ${DEEP_SINGLES + HELD + 1}`);
  });

  it('has nothing to show when the pool itself stops short', async () => {
    // Illustrative rather than discriminating, and labelled as such: handed
    // only what a ten-deep fetch returned, every entry is removable and the
    // panel renders nothing. This is the shape the user was hitting.
    stubMusicBrainz(FIXTURE.slice(0, 10));
    await seedHeld();

    const results = await searchUpstream('candidate', 10);

    expect(results).toEqual([]);
  });
});

describe('ordering and the fields it does not use', () => {
  it('preserves MusicBrainz ordering and ignores the Lucene score', async () => {
    // `score` ascends while array order descends in relevance, so anything
    // sorting by score would return this reversed.
    stubMusicBrainz(FIXTURE);
    await seedHeld();

    const results = await searchUpstream('candidate', 15);

    expect(results.map((entry) => entry.mbid)).toEqual(
      SURVIVOR_POSITIONS.map((position) => mbid(position)),
    );
  });
});

describe('edges', () => {
  it('makes no catalogue query when nothing upstream is in scope', async () => {
    // **The return value cannot prove this.** With the early return deleted,
    // `.in('mbid', [])` errors, only `data` is destructured so the error is
    // discarded, and filtering an already-empty list still yields `[]` —
    // identical output. So the proof is that the query never happens.
    stubMusicBrainz(FIXTURE.slice(0, SINGLES));

    const client = adminModule.createAdminClient();
    const from = vi.spyOn(client, 'from');
    vi.spyOn(adminModule, 'createAdminClient').mockReturnValue(client);

    const results = await searchUpstream('candidate', 10);

    expect(results).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns an empty list when MusicBrainz is unreachable', async () => {
    stubMusicBrainzFailure();

    await expect(searchUpstream('candidate', 10)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Artist-shaped queries — F-018, `architecture.md` §7.5
// ---------------------------------------------------------------------------

/**
 * A stub that tells the three MusicBrainz endpoints apart.
 *
 * `stubMusicBrainz` above answers every path with `release-groups`, which is
 * why the artist path stays inert for every test written before this one — the
 * artist search sees no `artists` key and gives up. That is the intended
 * behaviour and worth knowing rather than discovering.
 */
function stubArtistAware(opts: {
  artists?: { id: string; name: string; score: number }[];
  discography?: (MbReleaseGroup & { score?: number })[];
  titleResults?: (MbReleaseGroup & { score?: number })[];
}) {
  const calls: string[] = [];
  const realFetch = globalThis.fetch.bind(globalThis);

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const target = typeof input === 'string' ? input : input.toString();
    if (!target.includes('musicbrainz.org')) return realFetch(input as RequestInfo, init);

    const url = new URL(target);
    const body = (() => {
      if (url.pathname.endsWith('/artist')) {
        calls.push('artist-search');
        return { artists: opts.artists ?? [] };
      }
      // Browse is distinguished from search by carrying an `artist` parameter.
      if (url.searchParams.has('artist')) {
        calls.push('browse');
        return { 'release-groups': opts.discography ?? [] };
      }
      calls.push('title-search');
      return { 'release-groups': opts.titleResults ?? [], count: 1 };
    })();

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { calls };
}

const ARTIST_MBID = '1a2b3c4d-0002-4000-8000-000000000001';

/** An album by the searched-for artist, which a title search would never find. */
function discographyAlbum(position: number): MbReleaseGroup & { score?: number } {
  return {
    id: `1a2b3c4d-0003-4000-8000-${String(position).padStart(12, '0')}`,
    title: `Real Album ${position}`,
    'primary-type': 'Album',
    'first-release-date': `199${position}-01-01`,
    'artist-credit': [{ name: 'Radiohead' }],
  } as MbReleaseGroup & { score?: number };
}

describe('an artist-shaped query reaches the artist, not records named after them', () => {
  it("returns the artist's own albums when the name matches exactly", async () => {
    // **The whole complaint in F-018.** Measured live, a bare `Radiohead`
    // search returns release groups *titled* "Radiohead" by X-Dream, Blarg and
    // Wesley Willis. Only resolving the artist reaches the real discography.
    stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead', score: 100 }],
      discography: [discographyAlbum(1), discographyAlbum(2)],
      titleResults: [group(11)],
    });

    const results = await searchUpstream('Radiohead');
    expect(results.map((r) => r.title)).toContain('Real Album 1');
  });

  it('puts the discography ahead of records merely titled after the artist', async () => {
    stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead', score: 100 }],
      discography: [discographyAlbum(1)],
      titleResults: [group(11)],
    });

    const results = await searchUpstream('Radiohead');
    expect(results[0].title).toBe('Real Album 1');
  });

  it('keeps the title results too, rather than replacing them', async () => {
    // A query can be both an artist and a title. Substituting would lose the
    // other half; merging loses nothing.
    stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead', score: 100 }],
      discography: [discographyAlbum(1)],
      titleResults: [group(11), group(12)],
    });

    const results = await searchUpstream('Radiohead');
    expect(results).toHaveLength(3);
  });

  it('does not browse a weaker match, even a genuinely related one', async () => {
    // **Measured: `Radiohead` returns `On a Friday` at 64** — really the
    // pre-1991 Radiohead. Browsing it would answer a different question than
    // the one typed, so score alone is not the gate.
    const { calls } = stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'On a Friday', score: 64 }],
      discography: [discographyAlbum(1)],
      titleResults: [group(11)],
    });

    const results = await searchUpstream('Radiohead');
    expect(calls).not.toContain('browse');
    expect(results.map((r) => r.title)).not.toContain('Real Album 1');
  });

  it('does not browse a score-100 match whose name is different', async () => {
    // Score 100 alone is not enough: MusicBrainz awards it generously, and a
    // different name means a different question.
    const { calls } = stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead Tribute Band', score: 100 }],
      discography: [discographyAlbum(1)],
      titleResults: [group(11)],
    });

    await searchUpstream('Radiohead');
    expect(calls).not.toContain('browse');
  });

  it('matches the name case- and whitespace-insensitively', async () => {
    const { calls } = stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead', score: 100 }],
      discography: [discographyAlbum(1)],
      titleResults: [],
    });

    await searchUpstream('  radiohead  ');
    expect(calls).toContain('browse');
  });

  it('still filters the discography for scope', async () => {
    // A browse returns everything credited to the artist, singles included.
    // The scope filter is not bypassed just because the source changed.
    stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead', score: 100 }],
      discography: [
        { ...discographyAlbum(1), 'primary-type': 'Single' } as MbReleaseGroup,
        discographyAlbum(2),
      ],
      titleResults: [],
    });

    const results = await searchUpstream('Radiohead');
    expect(results.map((r) => r.title)).toEqual(['Real Album 2']);
  });

  it('still hides albums the catalogue already holds', async () => {
    const held = discographyAlbum(1);
    const { error } = await admin.from('albums').insert({
      mbid: held.id,
      title: held.title,
      display_credit: 'Radiohead',
      primary_type: 'album',
    });
    if (error) throw error;

    stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead', score: 100 }],
      discography: [held, discographyAlbum(2)],
      titleResults: [],
    });

    const results = await searchUpstream('Radiohead');
    expect(results.map((r) => r.title)).toEqual(['Real Album 2']);
  });

  it('deduplicates a record both paths return', async () => {
    const shared = discographyAlbum(1);
    stubArtistAware({
      artists: [{ id: ARTIST_MBID, name: 'Radiohead', score: 100 }],
      discography: [shared],
      titleResults: [shared],
    });

    const results = await searchUpstream('Radiohead');
    expect(results).toHaveLength(1);
  });

  // A thrown network error goes through the real retry policy — three attempts
  // with 2s and 4s between them — on top of the title search's own pacing. The
  // file's 15s budget is tight for that; this one test gets its own.
  it(
    'leaves the title results untouched when the artist lookup fails',
    { timeout: 25_000 },
    async () => {
      // **The containment guarantee.** No query that works today may change
      // because a second, optional upstream path errored.
      const realFetch = globalThis.fetch.bind(globalThis);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const target = typeof input === 'string' ? input : input.toString();
        if (!target.includes('musicbrainz.org')) return realFetch(input as RequestInfo, init);
        if (new URL(target).pathname.endsWith('/artist')) throw new Error('artist index down');
        return new Response(JSON.stringify({ 'release-groups': [group(11)], count: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const results = await searchUpstream('Radiohead');
      expect(results.map((r) => r.title)).toEqual(['Candidate 11']);
    },
  );
});
