import { describe, expect, it } from 'vitest';

import { cataloguePath, hideHeldFrom, pageFrom, sortLinks } from './pagination';

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

describe('cataloguePath — direction', () => {
  it('omits the natural direction, so each ordering keeps one address', () => {
    expect(cataloguePath('year', 1, false)).toBe('/albums/all?sort=year');
    expect(cataloguePath('added', 1, false)).toBe('/albums/all');
  });

  it('names a reversed ordering', () => {
    expect(cataloguePath('year', 1, true)).toBe('/albums/all?sort=year&dir=rev');
  });

  it('carries direction across pages', () => {
    expect(cataloguePath('title', 3, true)).toBe('/albums/all?sort=title&dir=rev&page=3');
  });

  it('reverses the default sort without naming it', () => {
    // `added` is the default sort, so only the direction needs saying.
    expect(cataloguePath('added', 1, true)).toBe('/albums/all?dir=rev');
  });
});

describe('sortLinks — direction', () => {
  it('points the active sort at its own reversal', () => {
    const active = sortLinks('year', false).find((link) => link.current);

    expect(active?.href).toContain('dir=rev');
  });

  it('points an already-reversed active sort back to its natural direction', () => {
    const active = sortLinks('year', true).find((link) => link.current);

    expect(active?.href).not.toContain('dir=');
  });

  it('never carries the current direction onto another sort', () => {
    // Direction is a property of an ordering, not of the reader. Landing on
    // "title, reversed" because the previous sort happened to be reversed is a
    // state nobody asked for.
    for (const link of sortLinks('year', true).filter((l) => !l.current)) {
      expect(link.href).not.toContain('dir=');
    }
  });

  it('marks direction only on the active sort', () => {
    const links = sortLinks('year', true);

    expect(links.filter((link) => link.reversed)).toHaveLength(1);
    expect(links.find((link) => link.reversed)?.value).toBe('year');
  });
});

/**
 * `?mine=hide` — F-042, `architecture.md` §16.13.
 *
 * **The assertions that matter are the carrying ones.** A filter dropped by
 * paging or re-sorting would show the reader albums they had just asked to
 * hide, with nothing on the page admitting it — the same failure the `sort`
 * parameter's own tests were written for.
 */
describe('hiding what you already have', () => {
  it('is off unless the parameter says exactly "hide"', () => {
    expect(hideHeldFrom(undefined)).toBe(false);
    expect(hideHeldFrom('')).toBe(false);
    expect(hideHeldFrom('yes')).toBe(false);
    expect(hideHeldFrom('true')).toBe(false);
    expect(hideHeldFrom('hide')).toBe(true);
    // Repeated parameters arrive as an array; the first wins, as elsewhere.
    expect(hideHeldFrom(['hide', 'no'])).toBe(true);
  });

  it('is omitted from the URL when off, so one state has one address', () => {
    expect(cataloguePath('added', 1, false, false)).toBe('/albums/all');
    expect(cataloguePath('added', 1, false, true)).toBe('/albums/all?mine=hide');
  });

  it('survives paging', () => {
    expect(cataloguePath('added', 3, false, true)).toBe('/albums/all?mine=hide&page=3');
  });

  it('survives sorting and reversal together', () => {
    expect(cataloguePath('title', 2, true, true)).toBe(
      '/albums/all?sort=title&dir=rev&mine=hide&page=2',
    );
  });

  it('is carried by every sort link, not only the active one', () => {
    // **The one most likely to be missed.** Changing sort resets the page but
    // must not reset the filter — they answer different questions.
    for (const link of sortLinks('added', false, true)) {
      expect(link.href).toContain('mine=hide');
    }
    for (const link of sortLinks('added', false, false)) {
      expect(link.href).not.toContain('mine=');
    }
  });
});
