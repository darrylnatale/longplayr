/**
 * The Popular chart's fill rule.
 *
 * Pure and exported so the rule can be proven directly, in the way
 * `shouldOfferFallback`, `collectionOrder` and `byReleaseDate` already are — the
 * discovery service builds a cookie-bound client and cannot be called from a
 * test.
 *
 * **The floor and the caller's limit are two different numbers, and conflating
 * them is the mistake this module exists to prevent.** `product-spec.md` §8.3
 * decides a floor of 20 on chart length: external entries complete the chart to
 * 20 when internal activity yields fewer, and none are added when it yields 20
 * or more. A consumer's limit is independent and caps only what that consumer
 * renders. Browse passes 24, and **that 24 is not a product decision** — it is a
 * grid default shared verbatim with "Recently added", a section with no chart
 * semantics at all. It must never become the fill target.
 *
 * **The chart is never truncated to the floor.** A chart with thirty qualifying
 * internal albums is thirty long; Browse renders the first twenty-four of them
 * and no external entry appears at all.
 */

/**
 * The minimum chart length the external fill completes to.
 *
 * `product-spec.md` §8.3, clarified 2026-09-05: a floor, not a cap, and not
 * derived from any consumer's request.
 */
export const POPULAR_FLOOR = 20;

/**
 * How deep to read the internal chart for a caller wanting `limit` rows.
 *
 * **Not simply `limit`.** Reading only `limit` rows makes "internal is short of
 * the floor" indistinguishable from "internal merely exceeds this caller's
 * limit" — a caller asking for 5 would see 5 rows and could not tell whether the
 * chart held 5 or 500. Reading at least the floor turns a short read into proof:
 * fewer than `POPULAR_FLOOR` rows came back, therefore the chart is short.
 *
 * It also removes the need for a separate count query.
 */
export function internalReadDepth(limit: number): number {
  return Math.max(POPULAR_FLOOR, limit);
}

/**
 * How many external entries are needed to complete the chart to the floor.
 *
 * Zero once internal reaches the floor — **at or above 20, no external entry is
 * added, whatever the caller asked for.**
 */
export function externalShortfall(internalCount: number): number {
  return Math.max(0, POPULAR_FLOOR - internalCount);
}

/**
 * Internal results first, external appended, then the caller's cap.
 *
 * **Appended, never interleaved.** No score crosses the boundary between the two
 * sets and no formula compares them — `BlendedSource` remains a future shape
 * (`architecture.md` §8), and blending is not approved by this slice.
 *
 * **The external list is expected to arrive already excluding internal albums**,
 * because the query can do that far more cheaply than this can. The de-duplication
 * here is a second line rather than the first: it costs nothing, and it means a
 * caller that forgets the exclusion produces a short chart rather than a
 * duplicated one.
 *
 * A shortfall in external supply is tolerated silently and by design. §8.3's
 * floor is subject to supply, exactly as the feed's page size is: twenty come
 * back whenever twenty exist to come back.
 */
export function combinePopular<T extends { id: string }>({
  internal,
  external,
  limit,
}: {
  internal: readonly T[];
  external: readonly T[];
  limit: number;
}): T[] {
  const shortfall = externalShortfall(internal.length);
  const combined = shortfall === 0 ? [...internal] : [...internal, ...external.slice(0, shortfall)];

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const album of combined) {
    if (seen.has(album.id)) continue;
    seen.add(album.id);
    deduped.push(album);
  }

  return deduped.slice(0, limit);
}
