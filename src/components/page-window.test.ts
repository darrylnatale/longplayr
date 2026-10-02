import { describe, expect, it } from 'vitest';

import { pageWindow } from './page-window';

/**
 * The page window, proven directly because it is pure.
 *
 * **These are the cases the three consumers actually produce** — a follower
 * list with two pages, a collection with a handful, a catalogue with dozens —
 * rather than an abstract sweep. `design-reference.md` §13.
 */
describe('pageWindow', () => {
  it('renders nothing when everything fits on one page', () => {
    // The component already returns null here; this keeps the two agreeing.
    expect(pageWindow(1, 1)).toEqual([]);
    expect(pageWindow(1, 0)).toEqual([]);
  });

  it('shows every page, with no gap, when they all fit', () => {
    // A two-page follower list should look like a two-page follower list.
    expect(pageWindow(1, 2)).toEqual([1, 2]);
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never collapses a single skipped page into a gap', () => {
    // **The rule worth testing**, because an ellipsis is the same width as the
    // number it replaces and does less. Page 1 and 3..5 leaves only 2 missing.
    expect(pageWindow(4, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it('elides a run of two or more', () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, 'gap', 10]);
    expect(pageWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageWindow(10, 10)).toEqual([1, 'gap', 9, 10]);
  });

  it('keeps a fixed width however large the catalogue grows', () => {
    // The property that lets one control serve a catalogue of any size: the
    // slot count stops growing once the gaps appear.
    const mid = pageWindow(500, 1000);
    expect(mid).toEqual([1, 'gap', 499, 500, 501, 'gap', 1000]);
    expect(pageWindow(5000, 10_000)).toHaveLength(mid.length);
  });

  it('always offers the first and last page', () => {
    for (const [page, total] of [
      [1, 2],
      [7, 9],
      [50, 99],
      [99, 99],
    ] as const) {
      const slots = pageWindow(page, total);
      expect(slots[0]).toBe(1);
      expect(slots[slots.length - 1]).toBe(total);
    }
  });

  it('clamps a page outside the range instead of windowing around nothing', () => {
    // `/albums/all?page=99` on a two-page catalogue is a fact about the
    // request; the service already answers it with an empty window.
    expect(pageWindow(99, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(-5, 3)).toEqual([1, 2, 3]);
  });

  it('widens with span', () => {
    // **The first expectation here was wrong and the code was right.** At
    // span 2 on page 5, only page 2 separates 1 from 3 — and the single-page
    // rule above says show it rather than elide it. The two rules compose,
    // which is easier to get wrong by hand than to implement.
    expect(pageWindow(5, 20, 2)).toEqual([1, 2, 3, 4, 5, 6, 7, 'gap', 20]);

    // Far enough in that both gaps are real runs.
    expect(pageWindow(10, 20, 2)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
  });
});
