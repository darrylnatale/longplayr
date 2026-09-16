import { describe, expect, it } from 'vitest';

import {
  addCoverArtUrl,
  coverArtPromptUrl,
  isTruncated,
  toUncoveredAlbum,
  type UncoveredAlbumRow,
} from './artwork-worklist';

/**
 * The cover-art worklist's deep link and its honest empty case.
 *
 * **The link is the whole feature**, so it is asserted directly rather than
 * through the page. `architecture.md` §17b.
 */

const RELEASE_MBID = '0b0e4f1e-2222-4000-8000-000000000001';

function row(overrides: Partial<UncoveredAlbumRow> = {}): UncoveredAlbumRow {
  return {
    id: 'album-1',
    mbid: '0b0e4f1e-1111-4000-8000-000000000001',
    title: 'Unknown Pleasures',
    display_credit: 'Joy Division',
    releases: { mbid: RELEASE_MBID },
    ...overrides,
  };
}

describe('addCoverArtUrl', () => {
  it('points at the release, not the release-group', () => {
    // Cover art is uploaded against a release. `artwork.ts` fetches against
    // release-groups, so these are different identifiers and mixing them would
    // send the maintainer to a page that cannot accept an upload.
    expect(addCoverArtUrl(RELEASE_MBID)).toBe(
      `https://musicbrainz.org/release/${RELEASE_MBID}/add-cover-art`,
    );
  });
});

describe('toUncoveredAlbum', () => {
  it('carries the album through with a working link', () => {
    const album = toUncoveredAlbum(row());

    expect(album.title).toBe('Unknown Pleasures');
    expect(album.credit).toBe('Joy Division');
    expect(album.addCoverArtUrl).toContain('/add-cover-art');
  });

  it('returns a null link rather than a broken one when there is no release', () => {
    // `representative_release_id` is nullable. The row is still produced — the
    // page shows it with the reason — because dropping it would leave the list
    // disagreeing with the count printed beside it.
    const album = toUncoveredAlbum(row({ releases: null }));

    expect(album.addCoverArtUrl).toBeNull();
    expect(album.title).toBe('Unknown Pleasures');
  });
});

describe('isTruncated', () => {
  it('is true when the list shows fewer than it counted', () => {
    expect(isTruncated(50, 161)).toBe(true);
  });

  it('is false when the list shows everything', () => {
    expect(isTruncated(45, 45)).toBe(false);
  });

  it('is false when there is nothing to show', () => {
    expect(isTruncated(0, 0)).toBe(false);
  });
});

describe('coverArtPromptUrl', () => {
  it('offers a route when Cover Art Archive holds nothing', () => {
    expect(coverArtPromptUrl('absent', RELEASE_MBID)).toContain('/add-cover-art');
  });

  it('offers nothing while the fetch has not run', () => {
    // `pending` means we have not asked yet — art may well be waiting, and
    // prompting would ask a person for work the system is about to do.
    expect(coverArtPromptUrl('pending', RELEASE_MBID)).toBeNull();
  });

  it('offers nothing when our own fetch failed', () => {
    // `failed` is our error, and the sweep is already retrying it.
    expect(coverArtPromptUrl('failed', RELEASE_MBID)).toBeNull();
  });

  it('offers nothing when the album already has a cover', () => {
    expect(coverArtPromptUrl('found', RELEASE_MBID)).toBeNull();
  });

  it('offers nothing when there is no release to send anyone to', () => {
    // Cover art is uploaded against a release. Without one there is nowhere to
    // point, and a reader should see no prompt rather than a dead one.
    expect(coverArtPromptUrl('absent', null)).toBeNull();
  });
});
