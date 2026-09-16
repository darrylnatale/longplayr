import {
  CATALOGUE_SORT_OPTIONS,
  DEFAULT_CATALOGUE_SORT,
} from '@/services/catalogue/catalogue-sort';

import type { CatalogueSort } from '@/services/catalogue/catalogue-sort';

/**
 * Query-string helpers for the catalogue-wide destination.
 *
 * **In the app layer, not in `src/services/`.** These build web addresses, and
 * `CLAUDE.md`'s test is that a rule belongs in the service layer only if a
 * native client would need it to behave correctly — a native client has no
 * `?page=`. `collectionPath` living inside `src/services/collection` is named
 * there as existing drift not to be repeated.
 *
 * **The page parsing is a fourth copy, and that is deliberate for now.**
 * `[handle]/pagination.ts` records the choice: _"deliberately duplicated rather
 * than shared: extracting it would put a web-routing helper somewhere both
 * could import from, and the only such place today is the service layer."_
 *
 * **That reasoning has a gap worth recording rather than acting on mid-cycle.**
 * `src/app/search/` already holds non-route modules (`fallback.ts`,
 * `upstream-display.ts`), so an **app-layer** shared home does exist and needs
 * no service-layer drift. Four copies of four lines is the point at which
 * extracting starts to pay; overturning a recorded decision to do it while
 * building something else is not.
 */

/**
 * `?page=` is user input and arrives as anything at all.
 *
 * Garbage, zero and negatives resolve to the first page rather than erroring —
 * a malformed page number is not worth a 404. Out-of-range pages are handled by
 * the route, where the total is known.
 */
export function pageFrom(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

/**
 * The address of one page of the catalogue.
 *
 * **Defaults are omitted, so every state has exactly one URL.** Page 1 is the
 * bare address and the default sort is unnamed — the rule the relationship
 * destinations already apply, extended to the second parameter so that four
 * addresses cannot render the same first page.
 */
export function cataloguePath(sort: CatalogueSort, page: number): string {
  const params = new URLSearchParams();
  if (sort !== DEFAULT_CATALOGUE_SORT) params.set('sort', sort);
  if (page > 1) params.set('page', String(page));

  const query = params.toString();
  return query ? `/albums/all?${query}` : '/albums/all';
}

/** The sort control's links, with the current mode marked. */
export function sortLinks(current: CatalogueSort) {
  return CATALOGUE_SORT_OPTIONS.map((option) => ({
    ...option,
    // Changing the sort returns to page one: page 7 of one ordering has no
    // meaningful counterpart in another, and keeping the number would land the
    // reader somewhere arbitrary.
    href: cataloguePath(option.value, 1),
    current: option.value === current,
  }));
}
