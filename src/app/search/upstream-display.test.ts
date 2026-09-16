import { describe, expect, it } from 'vitest';

import { INITIAL_VISIBLE, moreLabel, splitCandidates } from './upstream-display';

/**
 * The upstream panel's reveal, tested where the rule lives.
 *
 * **The panel itself gets no component test** — no `.test.tsx` may be added
 * while the component harness fails at worker startup under Node v20 — so the
 * rule sits in a pure module and the component stays thin enough that what is
 * left in it is markup. `product-spec.md` §8.10.
 */

const candidates = (n: number) => Array.from({ length: n }, (_, i) => `candidate-${i}`);

describe('splitCandidates', () => {
  it('shows the first ten and hides the rest', () => {
    const { shown, hidden } = splitCandidates(candidates(15));

    expect(shown).toHaveLength(INITIAL_VISIBLE);
    expect(hidden).toHaveLength(5);
  });

  it('hides nothing when everything already fits', () => {
    // The case that renders no expander at all, and says so instead.
    const { shown, hidden } = splitCandidates(candidates(4));

    expect(shown).toHaveLength(4);
    expect(hidden).toEqual([]);
  });

  it('keeps every candidate — the split loses none', () => {
    // The whole point: survivors were previously fetched and discarded.
    const all = candidates(15);
    const { shown, hidden } = splitCandidates(all);

    expect([...shown, ...hidden]).toEqual(all);
  });

  it('hides nothing at exactly the boundary', () => {
    const { hidden } = splitCandidates(candidates(INITIAL_VISIBLE));

    expect(hidden).toEqual([]);
  });

  it('handles an empty list without inventing rows', () => {
    expect(splitCandidates([])).toEqual({ shown: [], hidden: [] });
  });

  it('never hides everything, even if asked to', () => {
    // A non-positive limit would otherwise render a panel whose only content is
    // an expander — worse than the truncation being fixed.
    const { shown } = splitCandidates(candidates(3), 0);

    expect(shown.length).toBeGreaterThan(0);
  });
});

describe('moreLabel', () => {
  it('names how many are waiting', () => {
    expect(moreLabel(5)).toBe('Show 5 more');
  });
});
