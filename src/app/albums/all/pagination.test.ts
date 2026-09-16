import { describe, expect, it } from 'vitest';

import { cataloguePath, pageFrom, sortLinks } from './pagination';

/**
 * Addresses for the catalogue-wide destination (`product-spec.md` §6).
 */

describe('pageFrom', () => {
  it('reads a page number', () => {
    expect(pageFrom('3')).toBe(3);
  });

  it('resolves anything malformed to the first page rather than erroring', () => {
    // A bad page number is not worth a 404.
    for (const value of ['0', '-4', 'nonsense', '', undefined]) {
      expect(pageFrom(value)).toBe(1);
    }
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(pageFrom(['2', '9'])).toBe(2);
  });
});

describe('cataloguePath', () => {
  it('omits both defaults, so the first page has exactly one address', () => {
    // Four addresses rendering the same page is the thing this prevents.
    expect(cataloguePath('added', 1)).toBe('/albums/all');
  });

  it('names a non-default sort', () => {
    expect(cataloguePath('artist', 1)).toBe('/albums/all?sort=artist');
  });

  it('names a page beyond the first', () => {
    expect(cataloguePath('added', 4)).toBe('/albums/all?page=4');
  });

  it('carries both when both differ from the default', () => {
    expect(cataloguePath('year', 2)).toBe('/albums/all?sort=year&page=2');
  });
});

describe('sortLinks', () => {
  it('marks exactly one mode as current', () => {
    const links = sortLinks('title');

    expect(links.filter((link) => link.current)).toHaveLength(1);
    expect(links.find((link) => link.current)?.value).toBe('title');
  });

  it('returns to page one when the sort changes', () => {
    // Page 7 of one ordering has no counterpart in another; keeping the number
    // would land the reader somewhere arbitrary.
    for (const link of sortLinks('added')) {
      expect(link.href).not.toContain('page=');
    }
  });
});
