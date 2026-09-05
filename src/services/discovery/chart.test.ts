import { describe, expect, it } from 'vitest';

import { combinePopular, externalShortfall, internalReadDepth, POPULAR_FLOOR } from './chart';

/**
 * The Popular chart's fill rule.
 *
 * **The rule this file exists to pin is that the floor and the caller's limit are
 * different numbers.** `product-spec.md` §8.3 sets a floor of 20 on chart length;
 * Browse's 24 is a grid default with no product standing. An implementation that
 * fills to the caller's limit passes a naive reading of "fill below 20" and is
 * wrong — so the cases at 20, 22 and 23 are the load-bearing ones, not the
 * cold-start ones.
 *
 * These are proven here rather than against the database because the rule is
 * pure, and because the service builds a cookie-bound client that cannot be
 * called from a test.
 */

type Album = { id: string };

const albums = (prefix: string, count: number): Album[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}` }));

const BROWSE_LIMIT = 24;

describe('POPULAR_FLOOR', () => {
  it('is the 20 product-spec.md §8.3 decides', () => {
    expect(POPULAR_FLOOR).toBe(20);
  });
});

describe('internalReadDepth', () => {
  it('reads at least the floor, so a short read proves the chart is short', () => {
    expect(internalReadDepth(5)).toBe(20);
  });

  it('reads the caller limit when it exceeds the floor', () => {
    expect(internalReadDepth(BROWSE_LIMIT)).toBe(24);
  });
});

describe('externalShortfall', () => {
  it('asks for the whole floor when nothing internal qualifies', () => {
    expect(externalShortfall(0)).toBe(20);
  });

  it('asks for nothing once internal reaches the floor', () => {
    expect(externalShortfall(20)).toBe(0);
  });

  it('asks for nothing when internal exceeds the floor', () => {
    expect(externalShortfall(30)).toBe(0);
  });
});

describe('combinePopular — filling to the floor', () => {
  it('fills to 20 from an empty chart when supply permits', () => {
    const result = combinePopular({
      internal: [],
      external: albums('ext', 40),
      limit: BROWSE_LIMIT,
    });

    expect(result).toHaveLength(20);
    expect(result.every((album) => album.id.startsWith('ext-'))).toBe(true);
  });

  it('fills 10 internal up to 20', () => {
    const result = combinePopular({
      internal: albums('int', 10),
      external: albums('ext', 40),
      limit: BROWSE_LIMIT,
    });

    expect(result).toHaveLength(20);
    expect(result.slice(0, 10).map((a) => a.id)).toEqual(albums('int', 10).map((a) => a.id));
    expect(result.slice(10).every((album) => album.id.startsWith('ext-'))).toBe(true);
  });

  it('fills 19 internal with exactly one external', () => {
    const result = combinePopular({
      internal: albums('int', 19),
      external: albums('ext', 40),
      limit: BROWSE_LIMIT,
    });

    expect(result).toHaveLength(20);
    expect(result.filter((album) => album.id.startsWith('ext-'))).toHaveLength(1);
  });
});

describe('combinePopular — at and above the floor, nothing external is added', () => {
  // The three cases a "fill to the caller's limit" implementation gets wrong.
  it.each([20, 22, 23])('adds no external entry at %i internal', (count) => {
    const result = combinePopular({
      internal: albums('int', count),
      external: albums('ext', 40),
      limit: BROWSE_LIMIT,
    });

    expect(result).toHaveLength(count);
    expect(result.some((album) => album.id.startsWith('ext-'))).toBe(false);
  });

  it('returns 24 internal for a caller asking 24', () => {
    const result = combinePopular({
      internal: albums('int', 24),
      external: albums('ext', 40),
      limit: BROWSE_LIMIT,
    });

    expect(result).toHaveLength(24);
    expect(result.some((album) => album.id.startsWith('ext-'))).toBe(false);
  });

  it('caps 30 internal at the caller limit and adds nothing external', () => {
    const result = combinePopular({
      internal: albums('int', 30),
      external: albums('ext', 40),
      limit: BROWSE_LIMIT,
    });

    expect(result).toHaveLength(24);
    expect(result.map((a) => a.id)).toEqual(
      albums('int', 30)
        .slice(0, 24)
        .map((a) => a.id),
    );
  });

  it('never truncates internal to the floor before the caller limit', () => {
    // The chart is 30 long; the floor must not shorten it to 20.
    const result = combinePopular({
      internal: albums('int', 30),
      external: [],
      limit: 30,
    });

    expect(result).toHaveLength(30);
  });
});

describe('combinePopular — ordering and identity', () => {
  it('preserves internal order absolutely', () => {
    const internal = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];

    const result = combinePopular({ internal, external: [], limit: BROWSE_LIMIT });

    expect(result.map((a) => a.id)).toEqual(['c', 'a', 'b']);
  });

  it('preserves external order after the internal results', () => {
    const result = combinePopular({
      internal: albums('int', 18),
      external: [{ id: 'ext-z' }, { id: 'ext-a' }, { id: 'ext-m' }],
      limit: BROWSE_LIMIT,
    });

    expect(result.slice(18).map((a) => a.id)).toEqual(['ext-z', 'ext-a']);
  });

  it('removes a duplicate album, with the internal occurrence winning its position', () => {
    // The query excludes internal ids, so this is a second line of defence
    // rather than the first — it must not render the same album twice.
    const result = combinePopular({
      internal: [{ id: 'shared' }, { id: 'int-2' }],
      external: [{ id: 'shared' }, { id: 'ext-1' }],
      limit: BROWSE_LIMIT,
    });

    expect(result.filter((album) => album.id === 'shared')).toHaveLength(1);
    expect(result.map((a) => a.id)).toEqual(['shared', 'int-2', 'ext-1']);
  });
});

describe('combinePopular — supply and emptiness', () => {
  it('tolerates external supply below the shortfall and returns what exists', () => {
    // §8.3's floor is subject to supply, exactly as the feed's page size is.
    const result = combinePopular({
      internal: [],
      external: albums('ext', 5),
      limit: BROWSE_LIMIT,
    });

    expect(result).toHaveLength(5);
  });

  it('returns nothing when both sides are empty', () => {
    expect(combinePopular({ internal: [], external: [], limit: BROWSE_LIMIT })).toEqual([]);
  });
});
