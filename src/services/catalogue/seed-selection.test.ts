import { describe, expect, it } from 'vitest';

import type { PopularEntry } from '../discovery/popularity';
import { selectSeedCandidates } from './seed-selection';

const entry = (
  title: string,
  artistName: string,
  artistMbid: string | null,
  score: number,
): PopularEntry => ({
  mbid: `rg-${title.toLowerCase().replace(/\s+/g, '-')}`,
  title,
  artistName,
  artistMbid,
  score,
});

/** Popularity order, one artist dominating — the real shape of the problem. */
const CANDIDATES: PopularEntry[] = [
  entry('Album A1', 'Dominant', 'artist-1', 100),
  entry('Album A2', 'Dominant', 'artist-1', 99),
  entry('Album A3', 'Dominant', 'artist-1', 98),
  entry('Album A4', 'Dominant', 'artist-1', 97),
  entry('Album B1', 'Second', 'artist-2', 96),
  entry('Album B2', 'Second', 'artist-2', 95),
  entry('Album C1', 'Third', 'artist-3', 94),
];

describe('selectSeedCandidates — artist cap', () => {
  it('keeps every candidate when the cap is disabled', () => {
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: null });

    expect(result.selected).toHaveLength(7);
    expect(result.excludedByCap).toHaveLength(0);
    expect(result.distinctArtists).toBe(3);
  });

  it('keeps at most the cap per artist', () => {
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: 2 });

    expect(result.selected.map((e) => e.title)).toEqual([
      'Album A1',
      'Album A2',
      'Album B1',
      'Album B2',
      'Album C1',
    ]);
    expect(result.excludedByCap.map((e) => e.title)).toEqual(['Album A3', 'Album A4']);
  });

  it('keeps an artist’s most popular albums, not an arbitrary pair', () => {
    // The cap decides inclusion; it must never reorder by popularity.
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: 2 });
    const dominant = result.selected.filter((e) => e.artistName === 'Dominant');
    expect(dominant.map((e) => e.score)).toEqual([100, 99]);
  });

  it('preserves popularity order overall', () => {
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: 2 });
    const scores = result.selected.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('reports which artists were capped', () => {
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: 1 });

    expect(result.cappedArtists[0]).toEqual({ name: 'Dominant', kept: 1, excluded: 3 });
    expect(result.cappedArtists.map((a) => a.name)).toEqual(['Dominant', 'Second']);
  });

  it('applies a cap of 1 as one album per artist', () => {
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: 1 });
    expect(result.selected).toHaveLength(3);
    expect(result.distinctArtists).toBe(3);
  });
});

describe('selectSeedCandidates — artist identity', () => {
  it('groups by MBID, not by display name', () => {
    // Two genuinely different artists sharing a name must not be merged.
    const sameName = [
      entry('One', 'Nirvana', 'us-grunge-band', 100),
      entry('Two', 'Nirvana', 'us-grunge-band', 99),
      entry('Three', 'Nirvana', 'uk-prog-band', 98),
    ];

    const result = selectSeedCandidates(sameName, { maxPerArtist: 2 });

    expect(result.selected).toHaveLength(3);
    expect(result.distinctArtists).toBe(2);
  });

  it('treats one artist credited under different names as one artist', () => {
    const renamed = [
      entry('One', 'JAY-Z', 'jay-z', 100),
      entry('Two', 'Jay-Z', 'jay-z', 99),
      entry('Three', 'Jay Z', 'jay-z', 98),
    ];

    const result = selectSeedCandidates(renamed, { maxPerArtist: 2 });

    expect(result.selected).toHaveLength(2);
    expect(result.distinctArtists).toBe(1);
  });

  it('falls back to the name when no artist MBID is present', () => {
    const nameless = [
      entry('One', 'Unknown Band', null, 100),
      entry('Two', 'unknown band  ', null, 99),
      entry('Three', 'Unknown Band', null, 98),
    ];

    const result = selectSeedCandidates(nameless, { maxPerArtist: 2 });

    // Normalised, so casing and stray whitespace do not fragment the artist.
    expect(result.selected).toHaveLength(2);
    expect(result.distinctArtists).toBe(1);
  });
});

describe('selectSeedCandidates — limit', () => {
  it('stops once the limit is reached', () => {
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: 2, limit: 3 });
    expect(result.selected).toHaveLength(3);
  });

  it('counts only selected albums toward the limit', () => {
    // Capped albums must not consume the budget, or the cap would silently
    // shrink the catalogue.
    const result = selectSeedCandidates(CANDIDATES, { maxPerArtist: 1, limit: 3 });
    expect(result.selected.map((e) => e.artistName)).toEqual(['Dominant', 'Second', 'Third']);
  });

  it('handles an empty candidate list', () => {
    const result = selectSeedCandidates([], { maxPerArtist: 2 });
    expect(result).toMatchObject({ selected: [], excludedByCap: [], distinctArtists: 0 });
  });

  it('does not mutate the input', () => {
    const before = CANDIDATES.map((e) => e.title);
    selectSeedCandidates(CANDIDATES, { maxPerArtist: 1 });
    expect(CANDIDATES.map((e) => e.title)).toEqual(before);
  });
});
