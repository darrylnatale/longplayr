import { describe, expect, it } from 'vitest';

import { selectRepresentativeRelease, type ReleaseCandidate } from './representative-release';

const release = (overrides: Partial<ReleaseCandidate> & { mbid: string }): ReleaseCandidate => ({
  status: 'Official',
  date: '2000-01-01',
  country: 'GB',
  trackCount: 10,
  ...overrides,
});

describe('selectRepresentativeRelease', () => {
  it('returns null when there are no releases', () => {
    expect(selectRepresentativeRelease([])).toBeNull();
  });

  it('picks the earliest official release', () => {
    const chosen = selectRepresentativeRelease([
      release({ mbid: 'c', date: '2009-06-01' }),
      release({ mbid: 'a', date: '1997-03-01' }),
      release({ mbid: 'b', date: '2003-01-01' }),
    ]);
    expect(chosen?.mbid).toBe('a');
  });

  it('ignores earlier non-official releases', () => {
    // A bootleg predating the official pressing must not become the tracklist.
    const chosen = selectRepresentativeRelease([
      release({ mbid: 'bootleg', status: 'Bootleg', date: '1996-01-01' }),
      release({ mbid: 'official', status: 'Official', date: '1997-03-01' }),
    ]);
    expect(chosen?.mbid).toBe('official');
  });

  it('falls back to any status when nothing is official', () => {
    const chosen = selectRepresentativeRelease([
      release({ mbid: 'promo', status: 'Promotion', date: '1998-01-01' }),
      release({ mbid: 'bootleg', status: 'Bootleg', date: '1996-01-01' }),
    ]);
    expect(chosen?.mbid).toBe('bootleg');
  });

  it('treats status case insensitively', () => {
    const chosen = selectRepresentativeRelease([
      release({ mbid: 'lower', status: 'official', date: '1999-01-01' }),
      release({ mbid: 'bootleg', status: 'Bootleg', date: '1990-01-01' }),
    ]);
    expect(chosen?.mbid).toBe('lower');
  });

  it('prefers a dated release over an undated one', () => {
    const chosen = selectRepresentativeRelease([
      release({ mbid: 'undated', date: null }),
      release({ mbid: 'dated', date: '2005-01-01' }),
    ]);
    expect(chosen?.mbid).toBe('dated');
  });

  it('breaks a date tie on track count, then country', () => {
    const byTracks = selectRepresentativeRelease([
      release({ mbid: 'no-tracks', trackCount: 0 }),
      release({ mbid: 'has-tracks', trackCount: 12 }),
    ]);
    expect(byTracks?.mbid).toBe('has-tracks');

    const byCountry = selectRepresentativeRelease([
      release({ mbid: 'no-country', country: null }),
      release({ mbid: 'has-country', country: 'US' }),
    ]);
    expect(byCountry?.mbid).toBe('has-country');
  });

  it('breaks a complete tie on MBID, so the choice is deterministic', () => {
    const chosen = selectRepresentativeRelease([
      release({ mbid: 'ffff' }),
      release({ mbid: 'aaaa' }),
      release({ mbid: 'cccc' }),
    ]);
    expect(chosen?.mbid).toBe('aaaa');
  });

  it('produces the same answer regardless of input order', () => {
    // This is the property that actually matters: MusicBrainz does not promise
    // a stable ordering, and a tracklist that changes on re-sync is a bug.
    const releases = [
      release({ mbid: 'b', date: '2001-01-01' }),
      release({ mbid: 'a', date: '2001-01-01' }),
      release({ mbid: 'c', status: 'Bootleg', date: '1999-01-01' }),
      release({ mbid: 'd', date: null }),
    ];

    const orderings = [
      releases,
      [...releases].reverse(),
      [releases[2], releases[0], releases[3], releases[1]],
      [releases[3], releases[1], releases[2], releases[0]],
    ];

    const chosen = orderings.map((order) => selectRepresentativeRelease(order)?.mbid);
    expect(new Set(chosen).size).toBe(1);
    expect(chosen[0]).toBe('a');
  });

  it('does not mutate the array it is given', () => {
    const releases = [release({ mbid: 'z' }), release({ mbid: 'a' })];
    const before = releases.map((r) => r.mbid);
    selectRepresentativeRelease(releases);
    expect(releases.map((r) => r.mbid)).toEqual(before);
  });
});
