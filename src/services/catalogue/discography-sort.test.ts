import { describe, expect, it } from 'vitest';

import { byReleaseDate, type DiscographySort } from './queries';

/**
 * The discography ordering, in isolation.
 *
 * The sort happens in JavaScript rather than in the query — the discography
 * comes back through `album_artists`, so it is assembled in the service — which
 * makes it pure logic and testable directly. The integration suite proves the
 * query returns the right albums; this proves the order they come back in.
 *
 * The rule worth pinning is that **undated releases stay last in both
 * directions**. Reversing a comparator is the obvious way to implement
 * "oldest", and it is wrong here: it floats the undated ones to the top, where
 * they read as the earliest releases rather than as releases with no date.
 */

const album = (first_release_date: string | null) => ({ first_release_date });

const order = (dates: (string | null)[], sort: DiscographySort) =>
  [...dates.map(album)].sort(byReleaseDate(sort)).map((a) => a.first_release_date);

describe('newest first', () => {
  it('is the default direction', () => {
    expect(order(['1997-05-21', '2007-10-10', '2000-10-02'], 'newest')).toEqual([
      '2007-10-10',
      '2000-10-02',
      '1997-05-21',
    ]);
  });

  it('keeps undated releases last', () => {
    expect(order([null, '2000-01-01', '1990-01-01'], 'newest')).toEqual([
      '2000-01-01',
      '1990-01-01',
      null,
    ]);
  });
});

describe('oldest first', () => {
  it('reverses the dated run', () => {
    expect(order(['1997-05-21', '2007-10-10', '2000-10-02'], 'oldest')).toEqual([
      '1997-05-21',
      '2000-10-02',
      '2007-10-10',
    ]);
  });

  it('still keeps undated releases last, rather than floating them to the top', () => {
    // The whole point of the comparator not simply being reversed. An undated
    // release is not the earliest one; it is one with no date.
    expect(order([null, '2000-01-01', '1990-01-01'], 'oldest')).toEqual([
      '1990-01-01',
      '2000-01-01',
      null,
    ]);
  });
});

describe('the two directions are genuinely inverse for dated releases', () => {
  it('reverses the run without disturbing where undated releases sit', () => {
    const dates = ['2010-01-01', null, '1980-06-06', '1995-12-31', null];

    const newest = order(dates, 'newest');
    const oldest = order(dates, 'oldest');

    expect(newest.filter(Boolean)).toEqual([...oldest.filter(Boolean)].reverse());
    expect(newest.slice(-2)).toEqual([null, null]);
    expect(oldest.slice(-2)).toEqual([null, null]);
  });
});

describe('partial dates', () => {
  it('orders year-only against full dates by string comparison, which is chronological', () => {
    // Dates are stored ISO and may be year-only or year-month. Lexical order is
    // chronological for that shape, which is why no parsing happens here.
    expect(order(['2004', '2004-03-15', '1999-12-31'], 'newest')).toEqual([
      '2004-03-15',
      '2004',
      '1999-12-31',
    ]);
  });
});

describe('edge cases', () => {
  it('handles an empty discography', () => {
    expect(order([], 'newest')).toEqual([]);
    expect(order([], 'oldest')).toEqual([]);
  });

  it('handles a discography with no dates at all', () => {
    expect(order([null, null], 'newest')).toEqual([null, null]);
    expect(order([null, null], 'oldest')).toEqual([null, null]);
  });

  it('handles a single release', () => {
    expect(order(['2001-01-01'], 'oldest')).toEqual(['2001-01-01']);
  });
});
