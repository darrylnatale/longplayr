import { createAdminClient } from '@/lib/supabase/admin';

import { attemptStateFor } from './jobs';

import type { Database } from '@/lib/supabase/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

type Admin = SupabaseClient<Database>;

/**
 * Whether an artist's discography should be expanded on view, and whether one
 * is already in flight.
 *
 * **The rule, not the machinery.** `discoverAndIngestArtist` does the work and
 * is unchanged; this decides only whether to ask for it. It lives in its own
 * module rather than beside that function because `jobs.ts` already imports
 * `curated-tranche.ts`, so a rule needing both would close an import cycle.
 *
 * `product-spec.md` §8.9, `[DECIDED 2026-09-07]`.
 */

/**
 * MusicBrainz's `Various Artists`.
 *
 * **Excluded from automatic expansion, and this is a scope deferral rather than
 * a ruling.** `current-state.md` §11 records "whether depth applies to
 * pseudo-artists — `Various Artists` above all" as open, and says it must not
 * be answered implicitly — which is exactly what letting the trigger fire on
 * every artist page would do the first time someone opened this one. Its
 * "discography" is also unbounded in a way no other artist's is.
 *
 * **This is one identifier, not a class.** MusicBrainz's other special-purpose
 * artists are not covered: enumerating them would mean either verifying an
 * upstream list the contact rule forbids fetching locally, or inventing a set.
 * The open question names this artist, and so does this constant.
 */
const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';

/**
 * Whether this is a pseudo-artist — a catalogue placeholder rather than a
 * performer.
 *
 * **Two concerns read this, and they are deliberately not the same predicate.**
 * Expansion asks it because a pseudo-artist's discography is unbounded
 * (`isExcludedFromExpansion` below). Rendering asks it because a credit naming
 * one is not a route to anybody (`product-spec.md` §6, *Reaching an artist from
 * a credit*). **The identifier is shared; the questions are not**, and giving
 * the second caller the first one's name is how the two would later be changed
 * together by someone who thought they were one rule.
 */
export function isPseudoArtist(artistMbid: string): boolean {
  return artistMbid.toLowerCase() === VARIOUS_ARTISTS_MBID;
}

/** Whether an artist is withheld from automatic expansion. */
export function isExcludedFromExpansion(artistMbid: string): boolean {
  return isPseudoArtist(artistMbid);
}

/**
 * What the artist page should do about depth, in one value.
 *
 * | Value         | Enqueue? | Say something?                                  |
 * | ------------- | -------- | ----------------------------------------------- |
 * | `start`       | yes      | yes — fetching                                  |
 * | `outstanding` | no-op    | yes — fetching                                  |
 * | `failed`      | **no**   | **yes — couldn't finish, it will be retried**   |
 * | `settled`     | no       | no                                              |
 *
 * **`failed` is the state where those two columns diverge, and that divergence
 * is the point.** A terminally failed expansion warrants a **message** and must
 * not warrant **work**: enqueueing on failure from a page view would restart the
 * three-attempt retry policy on every visit, which `attemptStateFor` warns
 * against and which the recovery sweep now owns.
 *
 * **This reverses part of `architecture.md` §7's *A later view drains too*,
 * deliberately.** That decision found the page promising activity it had
 * disabled, and made the two conditions identical. Its point was that they must
 * not *disagree about the same state*; a state where the page speaks and does
 * nothing is not that. `product-spec.md` §6.
 *
 * **Derived from job history rather than from a column**, because `artists`
 * holds no such column and the slice that introduced this added no migration.
 * The album page does the equivalent with `hydration_status`.
 *
 * **Provenance is deliberately not consulted.** An artist that arrived through
 * a self-service add is as included as a curated one, so it expands on the same
 * terms (`CLAUDE.md`, catalogue breadth and depth).
 */
export type ExpansionState = 'start' | 'outstanding' | 'failed' | 'settled';

export async function expansionStateFor(
  artistMbid: string,
  admin: Admin = createAdminClient(),
): Promise<ExpansionState> {
  // Checked before the query, so an excluded artist costs no read at all.
  if (isExcludedFromExpansion(artistMbid)) return 'settled';

  const attempt = await attemptStateFor('discover_curated_artist', artistMbid, admin);

  if (attempt === 'none') return 'start';
  if (attempt === 'outstanding') return 'outstanding';
  // An excluded artist returned `settled` above, so this is a real attempt
  // history: every row finished, and none of them succeeded.
  if (attempt === 'failed') return 'failed';
  return 'settled';
}
