import { describe, expect, it } from 'vitest';

import { DRAIN_BUDGET_MS, maxDuration } from './route';

/**
 * The budget and the ceiling must not drift.
 *
 * They are two numbers in one file describing the same window, and the whole
 * point of deriving one from the other is that a future edit to `maxDuration`
 * cannot silently leave a budget that exceeds it. A budget at or above the
 * ceiling would start a job the platform is about to kill — which is exactly the
 * row this design exists to stop creating.
 */
describe('cron drain budget', () => {
  it('stays strictly inside the route ceiling', () => {
    expect(DRAIN_BUDGET_MS).toBeLessThan(maxDuration * 1000);
  });

  it('leaves real headroom rather than shaving the ceiling', () => {
    // Enough for a job started at the deadline to finish: artwork was measured
    // at roughly 9 seconds on staging.
    expect(maxDuration * 1000 - DRAIN_BUDGET_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('is a positive budget, so the drain can actually claim', () => {
    expect(DRAIN_BUDGET_MS).toBeGreaterThan(0);
  });
});
