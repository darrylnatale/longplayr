import { describe, expect, it } from 'vitest';

import {
  COLLECTION_SORT_OPTIONS,
  collectionOrder,
  collectionPath,
  DEFAULT_COLLECTION_SORT,
  parseCollectionSort,
  type CollectionSort,
} from './sort';

/**
 * Collection sorting, in isolation.
 *
 * The same seam `byReleaseDate` and `toCollectionListItem` use: `listCollection`
 * builds a cookie-bound client and cannot be called from a test, so the
 * integration suite proves the database returns these orders and this proves
 * the clauses and addresses it is asked for.
 *
 * Three things here have a wrong-looking obvious implementation, and each has
 * its own block below: a repeated query parameter (an array, not a string), the
 * `albums(column)` ordering spelling (the plausible alternative silently does
 * nothing), and the tiebreaker (without which a paged collection can show the
 * same album twice).
 */

const ALL_SORTS: CollectionSort[] = ['added', 'listened', 'rating', 'title', 'artist', 'year'];

describe('the mode list', () => {
  it('offers exactly the six decided modes, in control order', () => {
    expect(COLLECTION_SORT_OPTIONS.map((option) => option.value)).toEqual(ALL_SORTS);
  });

  it('leads with the default', () => {
    expect(COLLECTION_SORT_OPTIONS[0].value).toBe(DEFAULT_COLLECTION_SORT);
    expect(DEFAULT_COLLECTION_SORT).toBe('added');
  });

  it('labels every mode', () => {
    expect(COLLECTION_SORT_OPTIONS.map((option) => option.label)).toEqual([
      'Added',
      'Listened',
      'Rating',
      'Title',
      'Artist',
      'Year',
    ]);
  });
});

describe('parsing ?sort=', () => {
  it('accepts every one of the six values', () => {
    for (const sort of ALL_SORTS) {
      expect(parseCollectionSort(sort)).toBe(sort);
    }
  });

  it('accepts the default explicitly, even though the control never emits it', () => {
    // `?sort=added` is a legitimate address someone can type or bookmark. It
    // renders exactly what the bare URL renders.
    expect(parseCollectionSort('added')).toBe('added');
  });

  it('falls back to the default when the parameter is absent', () => {
    expect(parseCollectionSort(undefined)).toBe('added');
  });

  it('falls back rather than erroring on an unknown value', () => {
    // A malformed sort is not worth a 404 — the same rule `pageFrom` and the
    // artist page's `sortFrom` already follow.
    for (const value of ['banana', 'newest', 'oldest', 'date', 'added_at', '1', '-title']) {
      expect(parseCollectionSort(value), `?sort=${value}`).toBe('added');
    }
  });

  it('falls back on an empty value', () => {
    expect(parseCollectionSort('')).toBe('added');
  });

  it('is case-sensitive', () => {
    // Consistent with the artist page, where `?sort=NEWEST` is already an
    // invalid value that renders the default rather than being coerced.
    for (const value of ['TITLE', 'Title', 'Rating', 'YEAR']) {
      expect(parseCollectionSort(value), `?sort=${value}`).toBe('added');
    }
  });

  it('takes the first value when the key repeats', () => {
    // `searchParams` hands back an array when a key repeats. Stringifying it
    // would produce "rating,title" and match nothing.
    expect(parseCollectionSort(['rating', 'title'])).toBe('rating');
  });

  it('falls back when the first of a repeated pair is the invalid one', () => {
    // Deliberately does not hunt the array for something valid: the first value
    // wins, and if it is nonsense the whole thing falls back.
    expect(parseCollectionSort(['banana', 'title'])).toBe('added');
  });

  it('falls back on an empty array', () => {
    expect(parseCollectionSort([])).toBe('added');
  });
});

describe('addressing a collection', () => {
  it('is the bare path under the default sort on page one', () => {
    // The canonical address carries no query string at all — the same
    // convention that never writes `?page=1`.
    expect(collectionPath('darryl')).toBe('/darryl/collection');
    expect(collectionPath('darryl', { sort: 'added', page: 1 })).toBe('/darryl/collection');
  });

  it('names a non-default sort', () => {
    expect(collectionPath('darryl', { sort: 'title' })).toBe('/darryl/collection?sort=title');
    expect(collectionPath('darryl', { sort: 'year' })).toBe('/darryl/collection?sort=year');
  });

  it('omits the sort for the default even when a page is named', () => {
    expect(collectionPath('darryl', { sort: 'added', page: 3 })).toBe('/darryl/collection?page=3');
  });

  it('carries both when both are non-default', () => {
    expect(collectionPath('darryl', { sort: 'artist', page: 2 })).toBe(
      '/darryl/collection?sort=artist&page=2',
    );
  });

  it('omits page one', () => {
    expect(collectionPath('darryl', { sort: 'rating', page: 1 })).toBe(
      '/darryl/collection?sort=rating',
    );
  });
});

describe('a sort link resets pagination', () => {
  it('names no page at all, for any mode', () => {
    // This is the whole mechanism: changing sort returns you to page 1 because
    // the parameter is absent, not because anything redirects or clamps.
    for (const sort of ALL_SORTS) {
      expect(collectionPath('darryl', { sort }), sort).not.toContain('page');
    }
  });

  it('round-trips through the parser', () => {
    for (const sort of ALL_SORTS) {
      const href = collectionPath('darryl', { sort });
      const value = new URL(href, 'https://longplayr.test').searchParams.get('sort') ?? undefined;
      expect(parseCollectionSort(value), sort).toBe(sort);
    }
  });
});

describe('a pagination link preserves the sort', () => {
  it('carries a non-default mode to the next page', () => {
    // Dropping it would silently return the reader to Added one page in, with
    // nothing on the page admitting it had happened.
    for (const sort of ALL_SORTS.filter((s) => s !== 'added')) {
      expect(collectionPath('darryl', { sort, page: 2 }), sort).toBe(
        `/darryl/collection?sort=${sort}&page=2`,
      );
    }
  });

  it('omits the default mode', () => {
    expect(collectionPath('darryl', { sort: 'added', page: 2 })).toBe('/darryl/collection?page=2');
  });
});

describe('order clauses', () => {
  it('reproduces the previous ordering exactly for the default', () => {
    // The one clause this slice must not change. The overview passes no sort
    // and must keep the behaviour it had before sorting existed.
    expect(collectionOrder('added')).toEqual([{ column: 'added_at', ascending: false }]);
  });

  it('puts listened dates newest first with nulls last', () => {
    expect(collectionOrder('listened')).toEqual([
      { column: 'listened_on', ascending: false, nullsFirst: false },
      { column: 'added_at', ascending: false },
    ]);
  });

  it('puts ratings highest first with unrated last', () => {
    // Unrated stays *in* the collection and sorts to the end. Excluding it
    // would hide albums, which is a different claim than excluding nulls from
    // an average.
    expect(collectionOrder('rating')).toEqual([
      { column: 'rating', ascending: false, nullsFirst: false },
      { column: 'added_at', ascending: false },
    ]);
  });

  it('sorts titles A-Z', () => {
    expect(collectionOrder('title')).toEqual([
      { column: 'albums(title)', ascending: true },
      { column: 'added_at', ascending: false },
    ]);
  });

  it('sorts artists A-Z by the album credit, breaking ties on title', () => {
    expect(collectionOrder('artist')).toEqual([
      { column: 'albums(display_credit)', ascending: true },
      { column: 'albums(title)', ascending: true },
      { column: 'added_at', ascending: false },
    ]);
  });

  it('sorts release dates newest first with undated last', () => {
    expect(collectionOrder('year')).toEqual([
      { column: 'albums(first_release_date)', ascending: false, nullsFirst: false },
      { column: 'added_at', ascending: false },
    ]);
  });
});

describe('the rules every mode obeys', () => {
  it('ends every non-default mode with added_at descending', () => {
    // Without a deterministic final key, tied rows have no defined order and a
    // paged collection can show the same album on two pages and another on
    // none. `added_at` is effectively unique per user.
    for (const sort of ALL_SORTS.filter((s) => s !== 'added')) {
      const clauses = collectionOrder(sort);
      expect(clauses.at(-1), sort).toEqual({ column: 'added_at', ascending: false });
      expect(clauses.length, sort).toBeGreaterThan(1);
    }
  });

  it('names album columns in the embedded form the parent order honours', () => {
    // `albums(title)` in the top-level `order`, never `referencedTable:
    // 'albums'`. The latter emits `albums.order=`, which PostgREST applies
    // within an embedded collection and ignores for a to-one embed — measured
    // asc and desc returning byte-identical rows. It looks like it works.
    const albumColumns = ALL_SORTS.flatMap(collectionOrder)
      .map((clause) => clause.column)
      .filter((column) => column.includes('albums'));

    expect(albumColumns.length).toBeGreaterThan(0);
    for (const column of albumColumns) {
      expect(column).toMatch(/^albums\([a-z_]+\)$/);
    }
  });

  it('carries a null rule only where the column is nullable', () => {
    // `added_at`, `albums.title` and `albums.display_credit` are all `not
    // null`, so they emit no null rule; the three nullable keys all place nulls
    // last.
    const nullable = ['listened_on', 'rating', 'albums(first_release_date)'];

    for (const sort of ALL_SORTS) {
      for (const clause of collectionOrder(sort)) {
        if (nullable.includes(clause.column)) {
          expect(clause.nullsFirst, `${sort}/${clause.column}`).toBe(false);
        } else {
          expect(clause.nullsFirst, `${sort}/${clause.column}`).toBeUndefined();
        }
      }
    }
  });

  it('leads with a distinct key per mode', () => {
    const leads = ALL_SORTS.map((sort) => collectionOrder(sort)[0].column);
    expect(new Set(leads).size).toBe(ALL_SORTS.length);
  });
});
