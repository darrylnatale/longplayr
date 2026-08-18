import { describe, expect, it } from 'vitest';

import { isValidRating } from './index';
import { toOneDecimal } from './ratings';

/**
 * Pure rating logic. The database-backed averaging lives in the integration
 * suite; this covers the arithmetic and validation that need no I/O.
 */

describe('toOneDecimal', () => {
  it('keeps one decimal place', () => {
    expect(toOneDecimal(8.44)).toBe(8.4);
    expect(toOneDecimal(8.46)).toBe(8.5);
  });

  it('rounds a half up rather than down', () => {
    // 8.25 * 10 is 82.49999... in binary, so a naive round gives 8.2.
    expect(toOneDecimal(8.25)).toBe(8.3);
    expect(toOneDecimal(0.15)).toBe(0.2);
  });

  it('preserves the ends of the scale', () => {
    expect(toOneDecimal(0)).toBe(0);
    expect(toOneDecimal(10)).toBe(10);
  });

  it('handles a mean that is already exact', () => {
    expect(toOneDecimal(7)).toBe(7);
    expect(toOneDecimal(7.5)).toBe(7.5);
  });
});

describe('isValidRating', () => {
  it('accepts null, which means unrated', () => {
    expect(isValidRating(null)).toBe(true);
  });

  it('accepts both ends of the scale', () => {
    expect(isValidRating(0)).toBe(true);
    expect(isValidRating(10)).toBe(true);
  });

  it('accepts 0.0 as a real score, not as absence', () => {
    // The bug this guards: `if (!rating)` treats 0 as unrated.
    expect(isValidRating(0.0)).toBe(true);
  });

  it('accepts one decimal place', () => {
    expect(isValidRating(7.5)).toBe(true);
    expect(isValidRating(9.9)).toBe(true);
  });

  it('rejects more than one decimal place', () => {
    expect(isValidRating(7.55)).toBe(false);
    expect(isValidRating(0.01)).toBe(false);
  });

  it('rejects values outside the scale', () => {
    expect(isValidRating(-0.1)).toBe(false);
    expect(isValidRating(10.1)).toBe(false);
  });

  it('rejects values that are not finite numbers', () => {
    expect(isValidRating(Number.NaN)).toBe(false);
    expect(isValidRating(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
