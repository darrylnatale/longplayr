import { describe, expect, it } from 'vitest';

import { RECENT_READ_MULTIPLE, recentReadDepth, selectRecent } from './recent-selection';

import type { AlbumSummaryWithArtists } from './queries';

/**
 * What "Recently added" selects (`product-spec.md` §6).
 *
 * **The rules are tested separately as well as together**, because they are
 * independently reversible by decision — the cover rule does less as artwork
 * coverage improves and more as catalogue depth grows, so it may want removing
 * while deduplication stays.
 */

let n = 0;

function album(
  title: string,
  artistMbids: string[],
  artworkStatus: AlbumSummaryWithArtists['artwork_status'] = 'found',
): AlbumSummaryWithArtists {
  n += 1;
  return {
    id: `id-${n}`,
    mbid: `mbid-${n}`,
    title,
    display_credit: artistMbids.join(' & '),
    primary_type: 'album',
    artwork_status: artworkStatus,
    first_release_date: '2020-01-01',
    first_release_date_precision: 'day',
    releaseYear: '2020',
    artists: artistMbids.map((mbid) => ({ id: `a-${mbid}`, mbid, name: mbid, linkable: true })),
  };
}

describe('recentReadDepth', () => {
  it('reads several times what it renders', () => {
    expect(recentReadDepth(24)).toBe(24 * RECENT_READ_MULTIPLE);
    expect(recentReadDepth(12)).toBe(12 * RECENT_READ_MULTIPLE);
  });

  it('never reads nothing', () => {
    expect(recentReadDepth(0)).toBeGreaterThan(0);
  });
});

describe('selectRecent — one album per artist', () => {
  it('keeps the first album seen for an artist and drops the rest', () => {
    // "First" is "most recent" only because the query ordered it that way.
    // This module never sorts — see its header.
    const result = selectRecent(
      [album('Newest', ['radiohead']), album('Older', ['radiohead']), album('Other', ['clash'])],
      10,
      { onePerArtist: true },
    );

    expect(result.map((a) => a.title)).toEqual(['Newest', 'Other']);
  });

  it('claims every credit of a collaboration, blocking a guest later', () => {
    // **Inverted on 2026-09-16, not deleted.** This asserted the opposite:
    // Watch the Throne took JAY-Z's slot only and Kanye stayed free. That rule
    // let one artist occupy four slots by being credited second each time
    // (`product-spec.md` §6), so it was reversed.
    //
    // **This is the accepted cost, asserted so it cannot drift back silently.**
    // A guest is now blocked by a collaboration that came first.
    const result = selectRecent(
      [album('Watch the Throne', ['jayz', 'kanye']), album('Graduation', ['kanye'])],
      10,
      { onePerArtist: true },
    );

    expect(result.map((a) => a.title)).toEqual(['Watch the Throne']);
  });

  it('blocks an album whose guest already appeared, which is the case that reversed the rule', () => {
    // The rendered page carried four albums and one artist: a Tame Impala
    // record, then three collaborations crediting them *second*. Under the old
    // rule all four survived.
    const result = selectRecent(
      [
        album('A Transparent Night', ['tame']),
        album('Neverender (Remixes)', ['justice', 'tame']),
        album('Peace and Paranoia Tour', ['lips', 'tame']),
        album('My Life (remixes)', ['zhu', 'tame']),
      ],
      10,
      { onePerArtist: true },
    );

    expect(result.map((a) => a.title)).toEqual(['A Transparent Night']);
  });

  it('rejects the middle reading, which would let a guest appear twice', () => {
    // Blocking on any credit while claiming only the first was considered and
    // rejected. Under it, Y is unclaimed after the first album and so survives
    // the second. Under the chosen rule the second album is excluded.
    const result = selectRecent(
      [album('Collab A', ['x', 'y']), album('Collab B', ['y', 'z'])],
      10,
      { onePerArtist: true },
    );

    expect(result.map((a) => a.title)).toEqual(['Collab A']);
  });

  it('blocks a later album by a collaboration credit', () => {
    const result = selectRecent(
      [album('Watch the Throne', ['jayz', 'kanye']), album('Reasonable Doubt', ['jayz'])],
      10,
      { onePerArtist: true },
    );

    expect(result.map((a) => a.title)).toEqual(['Watch the Throne']);
  });

  it('never deduplicates an album that credits nobody', () => {
    // No identity to group on. Dropping it would hide a catalogue gap behind a
    // presentation rule.
    const result = selectRecent([album('Orphan A', []), album('Orphan B', [])], 10, {
      onePerArtist: true,
    });

    expect(result).toHaveLength(2);
  });
});

describe('selectRecent — covers only', () => {
  it('drops albums whose cover is missing, whatever the reason', () => {
    const result = selectRecent(
      [
        album('Has one', ['a'], 'found'),
        album('None upstream', ['b'], 'absent'),
        album('Not fetched', ['c'], 'pending'),
        album('Fetch failed', ['d'], 'failed'),
      ],
      10,
      { requireCover: true },
    );

    expect(result.map((a) => a.title)).toEqual(['Has one']);
  });

  it('lets an artist keep their slot with a later covered album', () => {
    // The ordering that matters: covers are filtered *before* deduplication, so
    // an artist whose newest album has no cover keeps their slot rather than
    // spending it on an album that was then removed, leaving a gap.
    const result = selectRecent(
      [album('Newest, no cover', ['radiohead'], 'absent'), album('Older, covered', ['radiohead'])],
      10,
      { onePerArtist: true, requireCover: true },
    );

    expect(result.map((a) => a.title)).toEqual(['Older, covered']);
  });
});

describe('selectRecent — limits and reversibility', () => {
  it('under-fills rather than reaching further', () => {
    // A tranche by one artist defeats any read depth. An honest short grid beats
    // an unbounded scan on the product's busiest surfaces.
    const result = selectRecent(
      [album('A', ['same']), album('B', ['same']), album('C', ['same'])],
      24,
      { onePerArtist: true },
    );

    expect(result).toHaveLength(1);
  });

  it('applies neither rule when neither is asked for', () => {
    // Both are reversible at the call site by decision, so the unfiltered path
    // is a supported behaviour rather than a fallback.
    const input = [album('A', ['same'], 'absent'), album('B', ['same'], 'pending')];

    expect(selectRecent(input, 24)).toHaveLength(2);
  });

  it('applies each rule alone', () => {
    const input = [album('A', ['same'], 'found'), album('B', ['same'], 'absent')];

    expect(selectRecent(input, 24, { onePerArtist: true })).toHaveLength(1);
    expect(selectRecent(input, 24, { requireCover: true })).toHaveLength(1);
  });

  it('caps at the limit', () => {
    const input = [album('A', ['x']), album('B', ['y']), album('C', ['z'])];

    expect(selectRecent(input, 2, { onePerArtist: true })).toHaveLength(2);
    expect(selectRecent(input, 2)).toHaveLength(2);
  });
});
