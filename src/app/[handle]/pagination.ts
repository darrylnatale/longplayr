/**
 * Query-string helpers for the relationship destinations.
 *
 * **In the app layer, not in `src/services/`.** These build web addresses, and
 * `CLAUDE.md`'s test is that a rule belongs in the service layer only if a
 * native client would need it to behave correctly — a native client has no
 * `?page=`. `collectionPath` living inside `src/services/collection` is named
 * there as existing drift not to be repeated, so this is where the equivalent
 * goes.
 */

/**
 * `?page=` is user input and arrives as anything at all.
 *
 * Garbage, zero and negatives resolve to the first page rather than erroring —
 * a malformed page number is not worth a 404. Out-of-range pages are handled
 * by the route, where the total is known.
 *
 * The same rule the collection destination applies, deliberately duplicated
 * rather than shared: extracting it would put a web-routing helper somewhere
 * both could import from, and the only such place today is the service layer.
 */
export function pageFrom(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

/**
 * The address of one page of a relationship list.
 *
 * Page 1 is the bare address, so the first page has exactly one URL rather than
 * two that render identically.
 */
export function relationshipPath(
  handle: string,
  kind: 'followers' | 'following',
  page: number,
): string {
  const base = `/${handle}/${kind}`;
  return page > 1 ? `${base}?page=${page}` : base;
}
