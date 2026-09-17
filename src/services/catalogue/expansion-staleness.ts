/**
 * When a discography is worth looking at again.
 *
 * **Expansion was once per artist, for as long as its job record survived.** So
 * a release issued after an artist's first expansion would **never** appear —
 * not late, never. `product-spec.md` §8.9.
 *
 * **The hazard this module is shaped around.** The once-per-artist rule exists
 * to stop a page view restarting the three-attempt retry policy, which
 * `attemptStateFor` warns against and the recovery sweep owns. **A staleness
 * window must not become that loop under another name**, so only a
 * *successful* expansion ever goes stale — a failed one stays the sweep's job
 * and a page view never re-queues it.
 */

/**
 * How long a successful expansion is trusted.
 *
 * **The same figure as the artwork re-check**, deliberately: `architecture.md`
 * §7 chose 30 days for re-examining a settled-absent cover, and **one staleness
 * idea is easier to hold than two.**
 *
 * **Seven days was rejected on upstream cost rather than on feel.** It would
 * roughly quadruple browse requests against a limit where exceeding one per
 * second returns `503` for **every** request from this address — and most
 * artists release nothing in any given week. Ninety days was rejected for the
 * opposite reason: a record released in September would be invisible until
 * December, which is a long time for a catalogue that is the product itself.
 */
export const EXPANSION_REFRESH_DAYS = 30;

/**
 * Whether a successful expansion is old enough to re-check.
 *
 * **Only ever called with the completion time of a _succeeded_ job.** Passing a
 * failed job's timestamp here is the mistake that turns a refresh back into a
 * retry, which is why the caller resolves that before asking.
 *
 * **A missing timestamp is not stale.** The opposite choice would be wrong in
 * the dangerous direction: a row whose time could not be read would be refreshed
 * on **every** view, which is the loop rather than a slow version of it.
 */
export function isExpansionStale(
  succeededAt: string | null,
  now: Date = new Date(),
  days = EXPANSION_REFRESH_DAYS,
): boolean {
  if (!succeededAt) return false;

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return new Date(succeededAt) < cutoff;
}
