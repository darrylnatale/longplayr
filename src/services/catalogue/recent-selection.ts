import type { AlbumSummaryWithArtists } from './queries';

/**
 * What "Recently added" selects, beyond being recent.
 *
 * **Pure and exported so the rule can be proven directly**, exactly as
 * `chart.ts` is and for the same stated reason: the catalogue service builds a
 * cookie-bound client and cannot be called from a test.
 *
 * **Two rules, deliberately independent** (`product-spec.md` §6). One album per
 * artist, and only albums that have a cover. They are separate options rather
 * than one behaviour because **they move in opposite directions over time**:
 * the cover rule does less as artwork coverage improves, and more as catalogue
 * depth grows. Reversing either must be a change at the call site.
 */

/**
 * How much deeper to read than the section renders.
 *
 * **Filtering and deduplicating happen after the read**, so reading exactly the
 * render count guarantees an under-filled grid the moment either rule removes
 * anything. This scales with the section — Browse reads ~192 to render 24, Home
 * ~96 to render 12 — rather than with the catalogue, which a flat constant
 * would not.
 *
 * **It is a multiplier and not a guarantee.** A tranche of uncovered albums by
 * one artist can defeat any depth, and in that case the section **under-fills
 * honestly** rather than scanning further. An unbounded scan on the product's
 * two busiest reads would be the worse failure.
 */
export const RECENT_READ_MULTIPLE = 8;

/** How many rows to read to render `limit`. */
export function recentReadDepth(limit: number): number {
  return Math.max(1, limit) * RECENT_READ_MULTIPLE;
}

export type RecentSelectionOptions = {
  /** Keep only each artist's most recent album. Counted against the first credit. */
  onePerArtist?: boolean;
  /** Keep only albums that have a cover. */
  requireCover?: boolean;
};

/**
 * Narrows an already-recency-ordered read to what the section shows.
 *
 * **This never sorts, and that is deliberate.** Ordering is the query's job, so
 * re-sorting here would hide a missing `order by` — and the rules below depend
 * on the input order being correct: deduplication keeps the *first* album it
 * sees for an artist, which is their most recent only because the query said
 * so.
 *
 * **The cover filter runs before deduplication, and the order matters.** An
 * artist whose newest album has no cover keeps their slot with their next one,
 * rather than spending it on an album that was then removed and leaving a gap.
 */
export function selectRecent(
  albums: AlbumSummaryWithArtists[],
  limit: number,
  options: RecentSelectionOptions = {},
): AlbumSummaryWithArtists[] {
  const { onePerArtist = false, requireCover = false } = options;

  const covered = requireCover ? albums.filter((a) => a.artwork_status === 'found') : albums;
  if (!onePerArtist) return covered.slice(0, limit);

  const seen = new Set<string>();
  const kept: AlbumSummaryWithArtists[] = [];

  for (const album of covered) {
    if (kept.length >= limit) break;

    // **The first credit only.** A collaboration spends that artist's slot and
    // leaves every other credited artist free to appear with their own record.
    // Counting against all credits was rejected: one collaboration would block
    // two artists from the whole section, which is a large effect for a rule
    // about visual variety (`product-spec.md` §6).
    //
    // **An album with no artist rows is never deduplicated away.** It has no
    // identity to group on, and silently dropping it would hide a catalogue
    // gap behind a presentation rule.
    const primary = album.artists[0]?.mbid;
    if (!primary) {
      kept.push(album);
      continue;
    }

    if (seen.has(primary)) continue;
    seen.add(primary);
    kept.push(album);
  }

  return kept;
}
