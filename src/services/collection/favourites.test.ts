import { describe, expect, it } from 'vitest';

import { toFavouriteListItem } from './favourites';

/**
 * The favourites mapping, in isolation.
 *
 * The integration suite proves the query — ordering, isolation, the cap — and
 * this proves what happens to the rows afterwards, because the service builds a
 * cookie-bound client that no test can call.
 */

const album = {
  mbid: 'b1392450-e666-3926-a536-22c65f834433',
  slug: 'ok-computer',
  title: 'OK Computer',
  display_credit: 'Radiohead',
  artwork_status: 'found' as const,
};

const row = { id: 'fav-1', album_id: 'album-1', position: 1, albums: album };

describe('a pinned album', () => {
  it('carries identity, artwork and its position', () => {
    const [item] = toFavouriteListItem(row);

    expect(item).toEqual({
      favouriteId: 'fav-1',
      albumId: 'album-1',
      position: 1,
      mbid: album.mbid,
      slug: 'ok-computer',
      title: 'OK Computer',
      credit: 'Radiohead',
      hasArtwork: true,
    });
  });

  it('carries no rating, like or relisten count', () => {
    // A favourite is a statement about taste, not a record of listening, and
    // the album may not be collected at all. Reading collection state onto it
    // would imply a relationship the model deliberately does not have.
    const [item] = toFavouriteListItem(row);

    expect(item).not.toHaveProperty('score');
    expect(item).not.toHaveProperty('liked');
    expect(item).not.toHaveProperty('relistens');
  });

  it('keeps a position from anywhere in the range, gaps included', () => {
    // Unpinning frees a position without renumbering, so 1, 2, 4, 5 is a legal
    // arrangement and the mapper must not normalise it.
    const [item] = toFavouriteListItem({ ...row, position: 7 });
    expect(item.position).toBe(7);
  });
});

describe('artwork', () => {
  it('is present only for found', () => {
    expect(toFavouriteListItem(row)[0].hasArtwork).toBe(true);
  });

  it.each(['pending', 'absent', 'failed'] as const)('is absent for %s', (artwork_status) => {
    const [item] = toFavouriteListItem({ ...row, albums: { ...album, artwork_status } });
    expect(item.hasArtwork).toBe(false);
  });
});

describe('a row whose album did not come back', () => {
  it('is dropped rather than rendered as a placeholder', () => {
    expect(toFavouriteListItem({ ...row, albums: null })).toEqual([]);
  });
});
