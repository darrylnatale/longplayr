import { describe, expect, it } from 'vitest';

import { COLLECTION_PAGE_SIZE, COLLECTION_PREVIEW_LIMIT, toCollectionListItem } from './index';

/**
 * The collection-grid mapping, in isolation.
 *
 * This is the one part of the read path the integration suite cannot reach:
 * `listCollection` builds a cookie-bound client and there is no request scope
 * in a test, so those tests exercise the query and this exercises what happens
 * to the rows afterwards. Between them the path is covered end to end.
 *
 * Every case here is one that has a wrong-looking obvious implementation.
 */

const album = {
  mbid: 'b1392450-e666-3926-a536-22c65f834433',
  title: 'OK Computer',
  display_credit: 'Radiohead',
  artwork_status: 'found' as const,
  first_release_date: '1997-05-21',
};

const row = {
  id: 'entry-1',
  album_id: 'album-1',
  rating: null as number | null,
  liked: false,
  relisten_count: 0,
  albums: album,
};

describe('rating', () => {
  it('keeps 0.0 as a real score rather than collapsing it to unrated', () => {
    // The lowest score in the product is falsy. `rating || null`, `rating ??
    // null` on a coerced value, or any truthiness check turns a deliberate 0.0
    // into "never rated", which is a different and much more common claim.
    const [item] = toCollectionListItem({ ...row, rating: 0 });

    expect(item.score).toBe(0);
    expect(item.score).not.toBeNull();
  });

  it('carries null through as unrated', () => {
    const [item] = toCollectionListItem({ ...row, rating: null });
    expect(item.score).toBeNull();
  });

  it('preserves one decimal place', () => {
    const [item] = toCollectionListItem({ ...row, rating: 9.4 });
    expect(item.score).toBe(9.4);
  });
});

describe('year', () => {
  it('takes the year from a full date', () => {
    const [item] = toCollectionListItem(row);
    expect(item.year).toBe(1997);
  });

  it('takes the year from a year-only date, which is stored padded', () => {
    // Partial dates are stored as a full date plus a precision marker, so the
    // leading four characters are the year under every precision.
    const [item] = toCollectionListItem({
      ...row,
      albums: { ...album, first_release_date: '1979-01-01' },
    });
    expect(item.year).toBe(1979);
  });

  it('is null when the catalogue holds no date, rather than 0 or NaN', () => {
    const [item] = toCollectionListItem({
      ...row,
      albums: { ...album, first_release_date: null },
    });
    expect(item.year).toBeNull();
  });
});

describe('artwork', () => {
  it('is present only for found', () => {
    const [item] = toCollectionListItem(row);
    expect(item.hasArtwork).toBe(true);
  });

  it.each(['pending', 'absent', 'failed'] as const)('is absent for %s', (artwork_status) => {
    // `absent` and `failed` are deliberately different facts elsewhere — one
    // about the artwork, one about the network. They collapse here and only
    // here, because both mean the same thing to a tile: draw the placeholder.
    const [item] = toCollectionListItem({ ...row, albums: { ...album, artwork_status } });
    expect(item.hasArtwork).toBe(false);
  });
});

describe('markers', () => {
  it('carries like and relisten state verbatim', () => {
    const [item] = toCollectionListItem({ ...row, liked: true, relisten_count: 3 });

    expect(item.liked).toBe(true);
    expect(item.relistens).toBe(3);
  });

  it('reports a never-relistened album as 0, not 1', () => {
    // The tile shows ×N only above 1. A collection entry is not itself a
    // relisten, so an album added and never replayed has a count of zero.
    const [item] = toCollectionListItem(row);
    expect(item.relistens).toBe(0);
  });
});

describe('a row whose album did not come back', () => {
  it('is dropped rather than rendered as a placeholder album', () => {
    // Unreachable behind the foreign key. Dropping it keeps the return type
    // honest without inventing a title to stand in for the missing one.
    expect(toCollectionListItem({ ...row, albums: null })).toEqual([]);
  });
});

describe('the bounds the surfaces render at', () => {
  /**
   * Pinned because they are product decisions (`product-spec.md` §6), not
   * tuning constants. Nothing breaks if they drift, which is exactly why a
   * change to either should have to be deliberate.
   */
  it('previews 12 on the overview and pages 60 on the destination', () => {
    expect(COLLECTION_PREVIEW_LIMIT).toBe(12);
    expect(COLLECTION_PAGE_SIZE).toBe(60);
  });

  it('never previews more than a page holds', () => {
    // A preview larger than a page would make the count link lead somewhere
    // showing fewer albums than the page that linked to it.
    expect(COLLECTION_PREVIEW_LIMIT).toBeLessThanOrEqual(COLLECTION_PAGE_SIZE);
  });
});
