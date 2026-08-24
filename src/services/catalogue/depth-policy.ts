import { classify } from './scope';

import type { MbReleaseGroup } from './musicbrainz';

/**
 * Catalogue **depth** policy — how much of an included artist we take now.
 *
 * This is not the same question as scope, and it deliberately does not live in
 * `scope.ts`.
 *
 * **Scope** says what the catalogue may ever hold. It is enforced at ingest for
 * every path, including self-service: `addAlbumFromUpstream` runs through the
 * same classifier. **Depth** says how much of an artist's body of work a
 * particular expansion takes, and it is explicitly temporary
 * (`docs/product-spec.md` §8.9).
 *
 * **Putting this in `scope.ts` would break a shipped feature.** Live albums,
 * compilations and soundtracks are in scope — a user adding one through the app
 * must still succeed. Narrowing the global classifier to the current depth
 * boundary would start refusing them, which is a regression rather than a
 * policy change.
 *
 * The current boundary is narrower than scope on purpose:
 *
 *   albums, EPs, mixtapes        included
 *   live, compilation,           excluded here, in scope generally —
 *   soundtrack, dj-mix           admitting them later is a depth decision
 *   singles                      excluded by scope, not by this
 *
 * **The gap is not a judgement about merit.** These release types are already
 * accepted by the catalogue; holding them out is a decision about how fast to
 * expand, and reversing it changes no schema.
 */

/**
 * Secondary types outside the **current** depth boundary.
 *
 * Note what is absent: `remix` and `demo` are accepted secondary types in scope
 * and are not excluded here, because §8.9's boundary names only these four.
 * Adding to this set is a product decision, not a tidy-up.
 */
const OUTSIDE_CURRENT_DEPTH = new Set(['live', 'compilation', 'soundtrack', 'dj-mix']);

export type DepthDecision = { inDepth: true } | { inDepth: false; reason: string };

/**
 * Applies the current depth boundary to a release group that is **already in
 * scope**.
 *
 * Composed after `classify()` rather than replacing it: scope decides whether a
 * record may exist at all, and this decides whether this expansion takes it.
 * Callers must run both — a release group failing scope never reaches here.
 */
export function withinCurrentDepth(group: MbReleaseGroup): DepthDecision {
  const scope = classify(group);
  if (!scope.inScope) {
    return { inDepth: false, reason: scope.reason };
  }

  const secondary = (group['secondary-types'] ?? []).map((type) => type.toLowerCase());

  for (const type of secondary) {
    if (OUTSIDE_CURRENT_DEPTH.has(type)) {
      return {
        inDepth: false,
        reason: `secondary type "${type}" is outside the current depth boundary`,
      };
    }
  }

  return { inDepth: true };
}
