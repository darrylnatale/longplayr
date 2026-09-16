/**
 * How much of the upstream panel is visible before asking for more.
 *
 * **This lives in the app layer deliberately, not in `src/services/`.**
 * `CLAUDE.md`'s test is whether a native client would need the rule to behave
 * correctly. It would not: which candidates survive filtering is a service
 * concern and already lives there, while *how many of them a page shows first*
 * shapes only what the web renders. Putting it in the service layer would be
 * the same boundary drift that rule exists to police.
 *
 * `product-spec.md` §8.10.
 */

/**
 * How many candidates the panel shows before the expander.
 *
 * **The panel is deliberately subordinate to the catalogue results above it**,
 * which return up to twenty. Ten was chosen on that basis and is unchanged —
 * what changes is that the rest are now reachable rather than discarded.
 */
export const INITIAL_VISIBLE = 10;

/**
 * Splits survivors into what is shown and what waits behind the expander.
 *
 * **Everything fetched is kept.** The upstream search already retrieves 25
 * release groups in one request and filtering leaves roughly fifteen, so
 * several candidates were being retrieved and thrown away. Revealing them costs
 * **no additional MusicBrainz request**, which matters against a limit where
 * exceeding one request per second returns `503` for every request from this
 * address.
 */
export function splitCandidates<T>(
  candidates: T[],
  visible: number = INITIAL_VISIBLE,
): { shown: T[]; hidden: T[] } {
  // A non-positive limit would otherwise hide everything and render a panel
  // whose only content is an expander.
  const safe = Math.max(1, visible);

  return { shown: candidates.slice(0, safe), hidden: candidates.slice(safe) };
}

/** The expander's label. */
export function moreLabel(hiddenCount: number): string {
  return `Show ${hiddenCount} more`;
}

/**
 * Said when every survivor is already on screen.
 *
 * **A different condition from finding nothing at all**, which keeps its own
 * "try a different spelling" advice. This one means MusicBrainz answered and
 * the answer is fully shown — worth stating rather than leaving the reader to
 * infer it from a control that is not there.
 */
export const ALL_SHOWN = 'That is everything MusicBrainz returned for this search.';
