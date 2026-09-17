import { describe, expect, it } from 'vitest';

import {
  CATALOGUE_SORT_OPTIONS,
  catalogueOrder,
  catalogueOrderFor,
  catalogueReversedFrom,
  catalogueSortFrom,
  DEFAULT_CATALOGUE_SORT,
  isCatalogueSort,
} from './catalogue-sort';

/**
 * The catalogue-wide surface's ordering (`product-spec.md` §6).
 *
 * **Deliberately separate from `collectionOrder`'s tests**, because the two
 * vocabularies are separate by decision: a catalogue has no rating or listened
 * date, and its `added` means when the catalogue got the album rather than when
 * a person did.
 */

describe('catalogueSortFrom', () => {
  it('accepts every mode the control offers', () => {
    for (const option of CATALOGUE_SORT_OPTIONS) {
      expect(catalogueSortFrom(option.value)).toBe(option.value);
    }
  });

  it('falls back to the default rather than erroring', () => {
    // `?sort=` is user input. A malformed one is not worth a 404 — the same
    // rule `?page=` already applies on the relationship destinations.
    expect(catalogueSortFrom('nonsense')).toBe(DEFAULT_CATALOGUE_SORT);
    expect(catalogueSortFrom(undefined)).toBe(DEFAULT_CATALOGUE_SORT);
    expect(catalogueSortFrom('')).toBe(DEFAULT_CATALOGUE_SORT);
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(catalogueSortFrom(['title', 'artist'])).toBe('title');
  });

  it('rejects a collection-only mode', () => {
    // `rating` and `listened` are real modes on a collection and meaningless
    // here. The separate vocabulary is what makes this a rejection rather than
    // a state this surface has to handle.
    expect(isCatalogueSort('rating')).toBe(false);
    expect(isCatalogueSort('listened')).toBe(false);
    expect(catalogueSortFrom('rating')).toBe(DEFAULT_CATALOGUE_SORT);
  });
});

describe('catalogueOrder', () => {
  it('orders newest first by default', () => {
    expect(catalogueOrder('added')).toEqual([{ column: 'created_at', ascending: false }]);
  });

  it('ends every mode at created_at, so the ordering is total', () => {
    // Pagination by `range()` needs a total order: without a final tiebreaker
    // two rows that compare equal can swap between requests and an album can
    // appear twice or not at all across a page boundary.
    for (const option of CATALOGUE_SORT_OPTIONS) {
      const clauses = catalogueOrder(option.value);
      expect(clauses.at(-1)).toEqual({ column: 'created_at', ascending: false });
    }
  });

  it('sorts artists by the printed credit, so The Clash files under T', () => {
    // The 2026-08-21 rule, reused rather than re-argued: an artist's sort_name
    // needs two joins and is undefined for a joint credit.
    const [first] = catalogueOrder('artist');

    expect(first).toEqual({ column: 'display_credit', ascending: true });
  });

  it('breaks an artist tie by title before falling back to recency', () => {
    expect(catalogueOrder('artist').map((c) => c.column)).toEqual([
      'display_credit',
      'title',
      'created_at',
    ]);
  });

  it('keeps undated releases last when sorting by year', () => {
    // Matching the discography sort rather than surfacing undated releases as
    // though they were the oldest records held.
    const [first] = catalogueOrder('year');

    expect(first).toMatchObject({ column: 'first_release_date', nullsFirst: false });
  });

  it('never orders by popularity', () => {
    // §8.3 decided an external popularity score exists only to stop a surface
    // looking empty and never orders one. Offering it as a sort here would
    // reintroduce by the back door what that decision removed from the front.
    for (const option of CATALOGUE_SORT_OPTIONS) {
      const columns = catalogueOrder(option.value).map((c) => c.column);
      expect(columns).not.toContain('popularity_score');
    }
  });
});

describe('catalogueOrderFor — running a sort the other way', () => {
  it('leaves every mode alone when not reversed', () => {
    for (const option of CATALOGUE_SORT_OPTIONS) {
      expect(catalogueOrderFor(option.value)).toEqual(catalogueOrder(option.value));
    }
  });

  it('flips only the leading clause', () => {
    // Tiebreakers are what make the ordering total, and `range()` pagination
    // depends on totality: two rows that can compare equal may swap between
    // requests, and an album then appears twice or not at all across a page.
    const forward = catalogueOrder('artist');
    const back = catalogueOrderFor('artist', true);

    expect(back[0].ascending).toBe(!forward[0].ascending);
    expect(back.slice(1)).toEqual(forward.slice(1));
  });

  it('keeps undated releases last in both directions', () => {
    // The specific failure `product-spec.md` §6 names: flipping `nullsFirst`
    // would put undated albums at the top of an oldest-first run, where they
    // read as the earliest records held rather than as records with no date.
    const forward = catalogueOrder('year');
    const back = catalogueOrderFor('year', true);

    expect(forward[0].nullsFirst).toBe(false);
    expect(back[0].nullsFirst).toBe(false);
    expect(back[0].ascending).toBe(true);
  });

  it('still ends every reversed mode at created_at, whichever way that runs', () => {
    // **The invariant is the column, not its direction.** Totality is what
    // `range()` pagination needs, and `created_at` supplies it either way.
    // Reversing "recently added" legitimately flips that clause, because there
    // it *is* the sort rather than the tiebreaker — an earlier version of this
    // test asserted `ascending: false` and was wrong about exactly that case.
    for (const option of CATALOGUE_SORT_OPTIONS) {
      expect(catalogueOrderFor(option.value, true).at(-1)?.column).toBe('created_at');
    }
  });

  it('flips the tiebreaker only when it is itself the sort', () => {
    expect(catalogueOrderFor('added', true).at(-1)?.ascending).toBe(true);
    expect(catalogueOrderFor('title', true).at(-1)?.ascending).toBe(false);
  });

  it('never orders by popularity in either direction', () => {
    for (const option of CATALOGUE_SORT_OPTIONS) {
      const columns = catalogueOrderFor(option.value, true).map((c) => c.column);
      expect(columns).not.toContain('popularity_score');
    }
  });
});

describe('catalogueReversedFrom', () => {
  it('reads the one recognised value', () => {
    expect(catalogueReversedFrom('rev')).toBe(true);
  });

  it('treats anything else as the natural direction', () => {
    // `?dir=` is user input, and a malformed one is not worth a 404 — the same
    // rule `?sort=` and `?page=` already apply.
    for (const value of ['asc', 'desc', 'nonsense', '', undefined]) {
      expect(catalogueReversedFrom(value)).toBe(false);
    }
  });
});
