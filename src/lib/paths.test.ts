import { describe, expect, it } from 'vitest';

import { albumPath, artistPath } from './paths';

/**
 * Catalogue URLs.
 *
 * **Thin by design.** The value of this module is that there is exactly one
 * place the shape is written down, not that the shape is complicated — so these
 * assert the contract rather than exercise logic that is not there.
 */

describe('albumPath', () => {
  it('routes to the album by slug', () => {
    expect(albumPath({ slug: 'kid-a' })).toBe('/albums/kid-a');
  });

  it('carries a counter slug through unchanged', () => {
    // A second album of the same title. Nothing here should re-derive it.
    expect(albumPath({ slug: 'kid-a-2' })).toBe('/albums/kid-a-2');
  });
});

describe('artistPath', () => {
  it('routes to the artist by slug', () => {
    expect(artistPath({ slug: 'radiohead' })).toBe('/artists/radiohead');
  });

  it('appends a discography sort when one is given', () => {
    expect(artistPath({ slug: 'radiohead' }, 'oldest')).toBe('/artists/radiohead?sort=oldest');
  });

  it('omits the parameter entirely for the default ordering', () => {
    // `?sort=newest` and no parameter mean the same thing, and the artist page
    // renders the default without one. Emitting it would make two URLs for one
    // page.
    expect(artistPath({ slug: 'radiohead' })).toBe('/artists/radiohead');
  });
});
