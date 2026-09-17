import { describe, expect, it } from 'vitest';

import { EXPANSION_REFRESH_DAYS, isExpansionStale } from './expansion-staleness';

/**
 * When a discography is worth re-checking (`product-spec.md` §8.9).
 *
 * **The asymmetry in the null case is the point of this file.** A missing
 * timestamp is *not* stale, because the opposite would be wrong in the
 * dangerous direction: a row whose time could not be read would be refreshed on
 * every view, which is the retry loop rather than a slow version of it.
 */

const NOW = new Date('2026-09-17T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('isExpansionStale', () => {
  it('leaves a recent expansion alone', () => {
    expect(isExpansionStale(daysAgo(1), NOW)).toBe(false);
  });

  it('refreshes one older than the window', () => {
    expect(isExpansionStale(daysAgo(EXPANSION_REFRESH_DAYS + 1), NOW)).toBe(true);
  });

  it('does not refresh exactly at the window', () => {
    // Strictly older, so the boundary cannot flap between two views moments
    // apart and queue the same artist twice.
    expect(isExpansionStale(daysAgo(EXPANSION_REFRESH_DAYS), NOW)).toBe(false);
  });

  it('treats a missing timestamp as fresh, not stale', () => {
    // Deliberately the cautious direction. Treating null as stale would refresh
    // on every single view — the loop the once-per-artist rule exists to stop.
    expect(isExpansionStale(null, NOW)).toBe(false);
  });

  it('honours an explicit window, so the constant is not the only testable value', () => {
    expect(isExpansionStale(daysAgo(10), NOW, 7)).toBe(true);
    expect(isExpansionStale(daysAgo(10), NOW, 14)).toBe(false);
  });

  it('uses the same window as the artwork re-check', () => {
    // One staleness idea rather than two. `architecture.md` §7 chose 30 days for
    // re-examining a settled-absent cover; this follows it rather than inventing
    // a second figure to reason about.
    expect(EXPANSION_REFRESH_DAYS).toBe(30);
  });
});
