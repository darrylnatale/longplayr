/**
 * When the MusicBrainz fallback is offered.
 *
 * Pure and exported so the rule can be proven directly, in the way
 * `collectionOrder` and `byReleaseDate` already are — the search page builds a
 * cookie-bound client and cannot be called from a test.
 *
 * **The absence of a result count in this signature is the decision.**
 * `product-spec.md` §6 has always promised the fallback whenever an in-scope
 * album is not in the catalogue, unconditionally. The implementation had
 * quietly made it conditional — the panel rendered only when the local
 * catalogue returned fewer than five albums — which meant a record the
 * catalogue did not hold became **unreachable** whenever five loose local
 * matches crowded it out. Searching for "the warning" returned a page of
 * albums beginning with "The" and no way to add the one being looked for.
 *
 * That condition was never a decision, and it is removed rather than ratified
 * (`[DECIDED 2026-08-22]`). Nothing about how many local results were found may
 * enter this function; a future caller cannot reintroduce the gate without
 * changing the signature, which is the point.
 *
 * **The signed-in condition stays**, and is a decision rather than an
 * accident: searching an external service on behalf of anonymous traffic is
 * rate-limit exposure longplayr does not take, and MusicBrainz answers a
 * breach with `503` for every request from the address rather than only the
 * excess.
 */
/**
 * The shortest query worth spending an upstream request on.
 *
 * **Added when search began updating as you type (F-002).** Before that, a
 * query reached here only when somebody pressed enter, so one-character
 * searches were vanishingly rare and the cost of allowing them was nil. Now
 * the URL moves whenever typing pauses for 400ms, and a pause after the first
 * letter is an ordinary thing to do.
 *
 * **Three, because the cost is asymmetric.** A one- or two-letter prefix buys
 * a page of records that merely begin with those letters — while spending up
 * to three requests against MusicBrainz's ceiling of **one per second**, where
 * exceeding it returns `503` for every request from this address rather than
 * only the excess. The local catalogue search is unaffected and still runs
 * from the first character.
 */
export const MIN_UPSTREAM_QUERY_LENGTH = 3;

export function shouldOfferFallback({
  query,
  isSignedIn,
}: {
  query: string;
  isSignedIn: boolean;
}): boolean {
  // Trimmed rather than merely truthy. A query of spaces is not a search — the
  // catalogue normalises it away and returns nothing, and spending a
  // rate-limited upstream request on it would buy the same nothing more slowly.
  return query.trim().length >= MIN_UPSTREAM_QUERY_LENGTH && isSignedIn;
}
