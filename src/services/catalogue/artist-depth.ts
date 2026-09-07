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

/** Whether an artist is withheld from automatic expansion. */
export function isExcludedFromExpansion(artistMbid: string): boolean {
  return artistMbid.toLowerCase() === VARIOUS_ARTISTS_MBID;
}

/**
 * What the artist page should do about depth, in one value.
 *
 * | Value         | Meaning                                                  |
 * | ------------- | -------------------------------------------------------- |
 * | `start`       | Never attempted — enqueue one, and say so                 |
 * | `outstanding` | One is queued or running — say so, enqueue nothing        |
 * | `settled`     | Attempted and finished, or excluded — say and do nothing  |
 *
 * **One value drives both the enqueue and the status line**, which is what
 * keeps them from disagreeing. The album page does the same with
 * `hydration_status`; this artist-level equivalent is derived from job history
 * rather than from a column, because `artists` holds no such column and this
 * slice introduces no migration.
 *
 * **Provenance is deliberately not consulted.** An artist that arrived through
 * a self-service add is as included as a curated one, so it expands on the same
 * terms (`CLAUDE.md`, catalogue breadth and depth).
 */
export type ExpansionState = 'start' | 'outstanding' | 'settled';

export async function expansionStateFor(
  artistMbid: string,
  admin: Admin = createAdminClient(),
): Promise<ExpansionState> {
  // Checked before the query, so an excluded artist costs no read at all.
  if (isExcludedFromExpansion(artistMbid)) return 'settled';

  const attempt = await attemptStateFor('discover_curated_artist', artistMbid, admin);

  if (attempt === 'none') return 'start';
  if (attempt === 'outstanding') return 'outstanding';
  return 'settled';
}
