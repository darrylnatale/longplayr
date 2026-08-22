import { describe, expect, it } from 'vitest';

import { shouldOfferFallback } from './fallback';

/**
 * The rule deciding whether the MusicBrainz fallback is offered.
 *
 * Tested here because it cannot be tested where it matters. Locally
 * `MUSICBRAINZ_CONTACT` is a placeholder and the client throws before any
 * fetch, so `searchUpstream` returns an empty list and **the panel never
 * renders in an end-to-end run**. The seven-album fixture catalogue also cannot
 * produce the five-local-result condition that caused the defect — the measured
 * maximum for any query is three. Both limits are recorded in
 * `tests/e2e/search.spec.ts`.
 *
 * So this file carries the load: it proves the rule no longer consults a result
 * count, which is the whole of the fix.
 */

describe('a query is required', () => {
  it('offers nothing without one', () => {
    expect(shouldOfferFallback({ query: '', isSignedIn: true })).toBe(false);
  });

  it('treats whitespace as no query', () => {
    // The catalogue normalises this away and returns nothing; spending a
    // rate-limited upstream request on it would buy the same nothing slower.
    expect(shouldOfferFallback({ query: '   ', isSignedIn: true })).toBe(false);
    expect(shouldOfferFallback({ query: '\t\n ', isSignedIn: true })).toBe(false);
  });

  it('offers the fallback for a real query', () => {
    expect(shouldOfferFallback({ query: 'the warning', isSignedIn: true })).toBe(true);
  });

  it('accepts a query that only becomes real after trimming', () => {
    expect(shouldOfferFallback({ query: '  in rainbows  ', isSignedIn: true })).toBe(true);
  });
});

describe('a session is required', () => {
  it('never offers the fallback to a signed-out visitor', () => {
    // A decision, not an accident: searching MusicBrainz on behalf of anonymous
    // traffic is rate-limit exposure, and a breach returns 503 for every
    // request from the address rather than only the excess.
    expect(shouldOfferFallback({ query: 'the warning', isSignedIn: false })).toBe(false);
  });

  it('refuses regardless of how promising the query looks', () => {
    for (const query of ['a', 'radiohead', 'ok computer', 'ゆらゆら帝国']) {
      expect(shouldOfferFallback({ query, isSignedIn: false }), query).toBe(false);
    }
  });
});

/**
 * **The regression guard is the type signature, not a test in here.**
 *
 * The defect was a `< 5` gate on local album results, so the fix is not that a
 * number changed — it is that no number is available to change.
 * `shouldOfferFallback` accepts `{ query, isSignedIn }` and nothing else, and
 * TypeScript's excess-property checking rejects a call that tries to pass one:
 *
 *     error TS2353: Object literal may only specify known properties, and
 *     'albumCount' does not exist in type '{ query: string; isSignedIn: boolean }'
 *
 * Two runtime tests previously sat here claiming to prove that. They did not —
 * one asserted the keys of an object literal written in the test, the other
 * mapped over counts it never used. Both would have passed with the gate fully
 * reinstated, and with the function deleted. They were removed rather than
 * rewritten, because the guarantee they were reaching for is enforced at
 * compile time and a runtime test cannot strengthen it.
 */
describe('the decision is query and session alone', () => {
  it('is decided by query and session alone', () => {
    const cases: [string, boolean, boolean][] = [
      ['', false, false],
      ['', true, false],
      ['the warning', false, false],
      ['the warning', true, true],
    ];

    for (const [query, isSignedIn, expected] of cases) {
      expect(shouldOfferFallback({ query, isSignedIn }), `${query}/${isSignedIn}`).toBe(expected);
    }
  });
});
