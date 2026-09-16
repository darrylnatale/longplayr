import { describe, expect, it } from 'vitest';

import { ABSENT_RECHECK_DAYS, absentRecheckCutoff, isAbsentAndStale } from './artwork-staleness';

/**
 * When a settled-absent cover is re-checked.
 *
 * **The rule exists because the cover-art prompt would otherwise be a dead
 * end** — someone uploads to Cover Art Archive and longplayr never looks again.
 * `architecture.md` §7.
 */

const NOW = new Date('2026-09-16T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('isAbsentAndStale', () => {
  it('leaves a freshly checked album alone', () => {
    // The case that protects the drain budget: re-asking a question answered
    // yesterday spends a slot a first-time fetch needed.
    expect(isAbsentAndStale(daysAgo(1), NOW)).toBe(false);
  });

  it('re-checks one checked longer ago than the window', () => {
    expect(isAbsentAndStale(daysAgo(ABSENT_RECHECK_DAYS + 1), NOW)).toBe(true);
  });

  it('does not re-check exactly at the window', () => {
    // Strictly older, so the boundary does not flap between two drains running
    // moments apart.
    expect(isAbsentAndStale(daysAgo(ABSENT_RECHECK_DAYS), NOW)).toBe(false);
  });

  it('treats a missing timestamp as stale', () => {
    // A state the current code does not produce. Re-checking once is cheaper
    // than an album permanently invisible to the sweep.
    expect(isAbsentAndStale(null, NOW)).toBe(true);
  });

  it('honours an explicit window, so the constant is not the only testable value', () => {
    expect(isAbsentAndStale(daysAgo(10), NOW, 7)).toBe(true);
    expect(isAbsentAndStale(daysAgo(10), NOW, 14)).toBe(false);
  });
});

describe('absentRecheckCutoff', () => {
  it('is the window before now', () => {
    const cutoff = absentRecheckCutoff(NOW, 30);

    expect(cutoff.toISOString()).toBe('2026-08-17T12:00:00.000Z');
  });
});
