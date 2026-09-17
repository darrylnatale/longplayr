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
 * How deep to read before filtering and deduplicating.
 *
 * **A fixed depth, not a multiple of what renders — and that correction is the
 * whole point of this constant. [AMENDED 2026-09-17]** It was `limit * 8`,
 * which assumed the depth needed scales with how many cells a section draws.
 * It does not: **it scales with how clustered the catalogue is**, and Home and
 * Browse must read past the same clusters whether they draw 12 cells or 24.
 *
 * **The clustering is severe because ingestion is artist-batched.** A curated
 * tranche or a discography expansion writes an artist's whole catalogue at
 * once, so a recency window is really a window over a handful of artists.
 * Measured on the deployed catalogue on 2026-09-17, the **192 most recently
 * added albums held just 21 distinct artists** — Dalida 37, Radiohead 31,
 * Belle and Sebastian 24.
 *
 * **What that produced, and what fixes it, both measured rather than guessed:**
 *
 * ```
 *   read 192  ->  11 survive   (what shipped; Browse renders 24)
 *   read 300  ->  15
 *   read 400  ->  23
 *   read 500  ->  29
 *   read 700  ->  47
 * ```
 *
 * **750 is chosen for headroom rather than sufficiency.** 400 would fill a
 * 24-cell section today, but one more large discography lands in front of it
 * and it would not — and the failure is silent, appearing as a short grid
 * nobody is told about.
 *
 * > **⚠️ This is a scan, and it is accepted knowingly rather than overlooked.**
 * > There is **no index on `created_at`**, so the read sorts most of the table
 * > on the product's two busiest pages. At roughly a thousand albums that is
 * > nothing. **It does not survive growth**, and the replacement is known: ask
 * > the database for one album per artist directly, which is bounded by artist
 * > count rather than album count. That needs a migration and was deliberately
 * > not taken here.
 */
export const RECENT_READ_DEPTH = 750;

/** How many rows to read to render `limit`. */
export function recentReadDepth(limit: number): number {
  // Never read less than is rendered, however the depth is later tuned.
  return Math.max(limit, RECENT_READ_DEPTH);
}

export type RecentSelectionOptions = {
  /**
   * Keep only each artist's most recent album.
   *
   * **Counted against every credited artist**, so an album is excluded when any
   * of its artists has already appeared and appearing claims all of them.
   * Reversed on 2026-09-16 from counting the first credit only.
   */
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

    // **Every credited artist, not just the first. [REVERSED 2026-09-16]** This
    // counted the first credit only until the rendered page showed what that
    // permits: **four albums and one artist**, because Tame Impala was credited
    // *second* on three of them. One artist occupying four slots is the exact
    // failure this rule exists to prevent (`product-spec.md` §6).
    //
    // **The cost is accepted rather than answered.** A collaboration now blocks
    // its guests: if Watch the Throne appears, Kanye West cannot also appear
    // with a solo record. The original decision named that cost and chose the
    // other way; the evidence that reversed it shows the cost of the old rule
    // and says nothing about the cost of this one.
    //
    // **An album crediting nobody is still never deduplicated away.** It has no
    // identity to group on, and silently dropping it would hide a catalogue gap
    // behind a presentation rule.
    const credits = album.artists.map((artist) => artist.mbid);
    if (credits.length === 0) {
      kept.push(album);
      continue;
    }

    if (credits.some((mbid) => seen.has(mbid))) continue;
    for (const mbid of credits) seen.add(mbid);
    kept.push(album);
  }

  return kept;
}
