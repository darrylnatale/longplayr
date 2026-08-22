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
  return query.trim().length > 0 && isSignedIn;
}
