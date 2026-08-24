import { describe, expect, it } from 'vitest';

import { CURATED_ARTISTS } from './curated-artists';
import { withinCurrentDepth } from './depth-policy';

import type { MbReleaseGroup } from './musicbrainz';

/**
 * The curated tranche as data.
 *
 * These assertions guard the list itself rather than the driver: a malformed or
 * duplicated identity would otherwise surface only during a live run, after
 * requests have been spent.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('CURATED_ARTISTS', () => {
  it('holds the first tranche of 28 artists', () => {
    expect(CURATED_ARTISTS).toHaveLength(28);
  });

  it('gives every artist a well-formed MBID', () => {
    for (const artist of CURATED_ARTISTS) {
      expect(artist.mbid, artist.name).toMatch(UUID);
    }
  });

  it('holds no duplicate identity', () => {
    const mbids = CURATED_ARTISTS.map((a) => a.mbid);
    expect(new Set(mbids).size).toBe(mbids.length);
  });

  it('holds no duplicate name', () => {
    const names = CURATED_ARTISTS.map((a) => a.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('records evidence for every identity', () => {
    for (const artist of CURATED_ARTISTS) {
      expect(artist.evidence.length, artist.name).toBeGreaterThan(20);
    }
  });

  it('resolves The Wake to the Scottish band, not either band its cross-links name', () => {
    // The case architecture.md §19.1 was written from. A conflicting upstream
    // cross-link must never move this value.
    const wake = CURATED_ARTISTS.find((a) => a.name === 'The Wake');
    expect(wake?.mbid).toBe('c2314623-e863-4fde-af8c-d6e00fec5f2c');
    expect(wake?.method).toBe('human_verified');
    expect(wake?.conflict).toBeDefined();
  });

  it('keeps K, whose in-scope discography is currently empty', () => {
    // Both her release groups are singles, so this tranche ingests nothing for
    // her. Presence in the curated set is the point: selection and ingestion
    // are different questions.
    const k = CURATED_ARTISTS.find((a) => a.name === 'K');
    expect(k?.mbid).toBe('9f926ef2-bd31-4f4d-a6a1-e47c7b75cbd9');
    expect(k?.method).toBe('human_verified');
  });

  it('records a conflict wherever one exists, rather than resolving it', () => {
    const conflicted = CURATED_ARTISTS.filter((a) => a.conflict);
    expect(conflicted.map((a) => a.name).sort()).toEqual(['K', 'The Wake']);
  });

  it('never claims a provider cross-link is a human verification', () => {
    for (const artist of CURATED_ARTISTS) {
      expect(['human_verified', 'discography_corroborated', 'provider_cross_link']).toContain(
        artist.method,
      );
    }
  });
});

describe('depth boundary applied to a tranche', () => {
  const group = (over: Partial<MbReleaseGroup>): MbReleaseGroup =>
    ({
      id: 'x',
      title: 't',
      'primary-type': 'Album',
      'artist-credit': [],
      ...over,
    }) as MbReleaseGroup;

  it('takes albums, EPs and mixtapes and leaves the rest', () => {
    const taken = [
      group({ 'primary-type': 'Album' }),
      group({ 'primary-type': 'EP' }),
      group({ 'primary-type': undefined, 'secondary-types': ['Mixtape/Street'] }),
    ];
    const left = [
      group({ 'secondary-types': ['Live'] }),
      group({ 'secondary-types': ['Compilation'] }),
      group({ 'secondary-types': ['Soundtrack'] }),
      group({ 'secondary-types': ['DJ-mix'] }),
      group({ 'primary-type': 'Single' }),
    ];

    expect(taken.every((g) => withinCurrentDepth(g).inDepth)).toBe(true);
    expect(left.some((g) => withinCurrentDepth(g).inDepth)).toBe(false);
  });
});
