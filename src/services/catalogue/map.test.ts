import { describe, expect, it } from 'vitest';

import {
  collaborationAlbum,
  emptyReleaseDetail,
  messyReleaseGroup,
  mixtapeWithoutPrimaryType,
  multiDiscReleaseDetail,
  singleArtistAlbum,
  singleDiscReleaseDetail,
  singleRelease,
  variousArtistsCompilation,
  yearOnlyAlbum,
} from './fixtures';
import { mapReleaseDetail, mapReleaseGroup, OutOfScopeError, renderCredit } from './map';

describe('renderCredit', () => {
  it('renders a single artist', () => {
    expect(renderCredit(singleArtistAlbum['artist-credit'])).toBe('Radiohead');
  });

  it('joins collaborators using the join phrases', () => {
    // The reason we cache this string rather than rebuilding it at render time.
    expect(renderCredit(collaborationAlbum['artist-credit'])).toBe('Jay-Z & Kanye West');
  });

  it('falls back when there is no credit at all', () => {
    expect(renderCredit(undefined)).toBe('Unknown Artist');
    expect(renderCredit([])).toBe('Unknown Artist');
  });
});

describe('mapReleaseGroup', () => {
  it('maps a straightforward album', () => {
    const result = mapReleaseGroup(singleArtistAlbum);

    expect(result.album).toMatchObject({
      mbid: singleArtistAlbum.id,
      title: 'In Rainbows',
      display_credit: 'Radiohead',
      primary_type: 'album',
      secondary_types: [],
      first_release_date: '2007-10-10',
      first_release_date_precision: 'day',
    });
    expect(result.artists).toHaveLength(1);
    expect(result.artists[0].artist.name).toBe('Radiohead');
  });

  it('keeps every credited artist, in credit order', () => {
    const result = mapReleaseGroup(collaborationAlbum);

    expect(result.artists.map((a) => [a.position, a.artist.name])).toEqual([
      [0, 'JAY-Z'],
      [1, 'Kanye West'],
    ]);
    // Credited name and canonical name differ; we store the canonical one and
    // display the cached credit string.
    expect(result.album.display_credit).toBe('Jay-Z & Kanye West');
  });

  it('maps a Various Artists compilation', () => {
    const result = mapReleaseGroup(variousArtistsCompilation);

    expect(result.album.secondary_types).toEqual(['compilation']);
    expect(result.artists[0].artist.name).toBe('Various Artists');
    expect(result.album.first_release_date_precision).toBe('year');
  });

  it('accepts a mixtape that arrives with no primary type', () => {
    const result = mapReleaseGroup(mixtapeWithoutPrimaryType);

    expect(result.album.primary_type).toBe('album');
    expect(result.album.secondary_types).toEqual(['mixtape']);
  });

  it('refuses a single', () => {
    // The one case where the correct outcome is that nothing is written.
    expect(() => mapReleaseGroup(singleRelease)).toThrow(OutOfScopeError);
  });

  it('preserves year-only precision rather than inventing a day', () => {
    const result = mapReleaseGroup(yearOnlyAlbum);

    expect(result.album.first_release_date).toBe('1979-01-01');
    expect(result.album.first_release_date_precision).toBe('year');
  });

  it('picks a deterministic representative release when none is official', () => {
    const result = mapReleaseGroup(messyReleaseGroup);

    // Two bootlegs tie on date; the MBID tiebreak decides, so re-ingesting
    // cannot silently change the tracklist.
    expect(result.representativeReleaseMbid).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('returns no representative release when there are no releases', () => {
    const result = mapReleaseGroup(variousArtistsCompilation);
    expect(result.representativeReleaseMbid).toBeNull();
    expect(result.releases).toEqual([]);
  });
});

describe('mapReleaseSummary — inside a release-group response', () => {
  it('records metadata but no tracklist, format or label', () => {
    const { release, tracks } = mapReleaseGroup(singleArtistAlbum).releases[0];

    // Verified against the live API: release groups embed release metadata
    // only. Assuming otherwise produced a catalogue where every album had an
    // empty tracklist.
    expect(release).toMatchObject({
      status: 'Official',
      country: 'GB',
      release_date: '2007-12-28',
      release_date_precision: 'day',
      format: null,
      label: null,
      track_count: null,
    });
    expect(tracks).toEqual([]);
  });
});

describe('mapReleaseDetail — a directly fetched release', () => {
  it('maps the tracklist, format and label', () => {
    const { release, tracks } = mapReleaseDetail(singleDiscReleaseDetail);

    expect(release).toMatchObject({ format: 'CD', label: 'XL Recordings', track_count: 2 });
    expect(tracks).toEqual([
      { position: 1, medium_position: 1, title: '15 Step', length_ms: 237000 },
      { position: 2, medium_position: 1, title: 'Bodysnatchers', length_ms: 242000 },
    ]);
  });

  it('keeps multi-disc positions distinct', () => {
    const { tracks } = mapReleaseDetail(multiDiscReleaseDetail);

    expect(tracks).toEqual([
      { position: 1, medium_position: 1, title: 'The Magnificent Seven', length_ms: 328000 },
      { position: 1, medium_position: 2, title: 'Lose This Skin', length_ms: 315000 },
    ]);
  });

  it('sums track-count across media rather than reading it off the release', () => {
    // track-count is a property of each medium. Reading it at the top level
    // yields null, which is the bug real data exposed.
    expect(mapReleaseDetail(multiDiscReleaseDetail).release.track_count).toBe(2);
  });

  it('orders by position, not by the display number', () => {
    // Vinyl numbering is "A1", "B2" — unusable for ordering.
    const { tracks } = mapReleaseDetail(multiDiscReleaseDetail);
    expect(tracks.map((t) => t.position)).toEqual([1, 1]);
  });

  it('handles a release with no media at all', () => {
    const { tracks, release } = mapReleaseDetail(emptyReleaseDetail);
    expect(tracks).toEqual([]);
    expect(release.track_count).toBeNull();
  });
});
