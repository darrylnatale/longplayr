/**
 * Which page numbers a pager shows, and where it elides.
 *
 * **Pure, and deliberately not in `src/services/`.** `CLAUDE.md`'s test is
 * whether a native client would need the rule to behave correctly — it would
 * not. This shapes what the web renders and nothing else, so it sits beside the
 * component that renders it. Being pure, it is tested directly rather than
 * through a browser. `design-reference.md` §13.
 *
 * **One control serves three surfaces with very different scales** — a
 * catalogue of hundreds of pages, a collection of a few, a follower list of
 * two — by degrading rather than by branching.
 */

/** A gap stands for two or more elided pages. Never for one — see below. */
export type PageSlot = number | 'gap';

/**
 * The slots to render, in order, always including the first and last page.
 *
 * `span` is how many pages to show either side of the current one, so the
 * control has a fixed maximum width however large the catalogue grows.
 *
 * **A run of exactly one page never becomes a gap.** An ellipsis is the same
 * width as the number it would replace and does less, so collapsing a single
 * page is strictly worse than showing it.
 */
export function pageWindow(page: number, totalPages: number, span = 1): PageSlot[] {
  if (totalPages <= 1) return [];

  // Defend against a page outside the range rather than rendering a window
  // around nothing: `/albums/all?page=99` on a two-page catalogue is a fact
  // about the request, which the service layer already answers with an empty
  // window and a real total.
  const current = Math.min(Math.max(page, 1), totalPages);

  const wanted = new Set<number>([1, totalPages]);
  for (let n = current - span; n <= current + span; n += 1) {
    if (n >= 1 && n <= totalPages) wanted.add(n);
  }

  const shown = [...wanted].sort((a, b) => a - b);
  const slots: PageSlot[] = [];

  shown.forEach((n, i) => {
    if (i > 0) {
      const missing = n - shown[i - 1] - 1;
      if (missing === 1) {
        // Exactly one page skipped: show it instead of eliding it.
        slots.push(n - 1);
      } else if (missing > 1) {
        slots.push('gap');
      }
    }
    slots.push(n);
  });

  return slots;
}
