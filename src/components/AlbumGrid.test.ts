import { describe, expect, it } from 'vitest';

import { BASE_COLUMNS, DENSITY, type GridDensity } from './AlbumGrid';

/**
 * The one invariant that makes `BASE_COLUMNS` safe to state twice.
 *
 * `design-reference.md` §11.10 decides that the leading cells of **one row at
 * the narrowest breakpoint** load eagerly, and derives the number from each
 * density's base column count. Production cannot compute that number from the
 * class string: Tailwind only generates classes it can see literally, so an
 * interpolated `grid-cols-${n}` would never be emitted and the grid would lose
 * its columns. The number is therefore written a second time — and this file is
 * the reason that is acceptable.
 *
 * **What it catches is drift, not arithmetic.** Someone re-tuning the ramp from
 * `grid-cols-2` to `grid-cols-3` and not touching `BASE_COLUMNS` gets a failure
 * here rather than a grid that eagerly loads the wrong number of covers for the
 * rest of its life. The parse lives in the test on purpose; putting it in
 * production would trade a stated constant for a fragile one.
 */

const DENSITIES: GridDensity[] = ['standard', 'dense', 'relaxed'];

/**
 * The unprefixed `grid-cols-N`, which is the narrowest breakpoint by
 * construction — every other entry in the ramp carries a `min-width` prefix, so
 * the only bare one is the base.
 */
function baseColumnsFromRamp(className: string): number {
  const bare = className
    .split(/\s+/)
    .filter((token) => !token.includes(':'))
    .find((token) => token.startsWith('grid-cols-'));

  if (!bare) throw new Error(`no unprefixed grid-cols-* in: ${className}`);
  return Number(bare.slice('grid-cols-'.length));
}

describe('the parser this test relies on', () => {
  // Asserted rather than assumed: a parser that silently matched a prefixed
  // class would make every case below pass for the wrong reason.
  it('ignores prefixed columns and reads only the bare one', () => {
    expect(baseColumnsFromRamp('grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-4')).toBe(2);
  });

  it('throws when a ramp has no unprefixed column count', () => {
    expect(() => baseColumnsFromRamp('gap-3 sm:grid-cols-4')).toThrow();
  });
});

describe('BASE_COLUMNS agrees with the density ramp', () => {
  it.each(DENSITIES)('%s', (density) => {
    expect(BASE_COLUMNS[density]).toBe(baseColumnsFromRamp(DENSITY[density]));
  });

  it('covers every density, so a fourth could not be added unnoticed', () => {
    expect(Object.keys(BASE_COLUMNS).sort()).toEqual([...DENSITIES].sort());
  });
});

describe('the values §11.10 decides', () => {
  // The relationship above is the guard; these are the numbers the decision
  // names, pinned so that a coordinated change to both records still has to be
  // deliberate rather than quiet.
  it('is two for relaxed, three for standard, four for dense', () => {
    expect(BASE_COLUMNS.relaxed).toBe(2);
    expect(BASE_COLUMNS.standard).toBe(3);
    expect(BASE_COLUMNS.dense).toBe(4);
  });
});
