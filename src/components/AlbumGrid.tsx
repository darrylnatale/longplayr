import Link from 'next/link';
import type { ReactNode } from 'react';

import { AlbumCover } from '@/components/AlbumCover';
import type { AlbumSummary } from '@/services/catalogue/queries';

/**
 * The square artwork grid — the product's signature surface.
 *
 * Density is defined **here and only here**. Every grid in longplayr renders
 * through this component so that cell proportion is one decision rather than
 * something each page settles for itself, which is precisely how a grid system
 * ends up decided by whichever component was written first
 * (docs/design-reference.md §5.1).
 *
 * The ramp lands on twelve columns at desktop, matching the reference's
 * measured density. Cell size stays roughly constant across breakpoints —
 * around 100-120px — and it is the column *count* that changes. Squares tile
 * more efficiently than the reference's 2:3 posters, so the same width holds a
 * third more rows: a wall of covers reads as a record shelf, which is the
 * intended thematic reading.
 *
 * Gutters follow the measured ~5:1 cell-to-gutter ratio, tightening below
 * tablet where every pixel of cell width matters more than the rhythm.
 */

export type GridDensity = 'standard' | 'dense' | 'relaxed';

export const DENSITY: Record<GridDensity, string> = {
  // The default shelf: 3 → 4 → 5 → 7 → 9 → 11 → 12.
  standard:
    'grid-cols-3 gap-2 min-[480px]:grid-cols-4 sm:grid-cols-5 sm:gap-3 md:grid-cols-7 lg:grid-cols-9 lg:gap-4 xl:grid-cols-11 2xl:grid-cols-12',
  // One step tighter, for pure browsing where recognition is all that matters.
  dense:
    'grid-cols-4 gap-1.5 min-[480px]:grid-cols-5 sm:grid-cols-7 sm:gap-2 md:grid-cols-9 lg:grid-cols-11 lg:gap-3 xl:grid-cols-13 2xl:grid-cols-14',
  // Fewer, larger cells. Detailed collection mode uses this: a title and credit
  // under a 105px cell would be unreadable, so adding metadata has to buy back
  // the room it needs rather than cramming it into the shelf density.
  relaxed:
    'grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8',
};

/**
 * Which stored asset a density draws from, and the intrinsic size hint.
 *
 * Cover Art Archive gives us 250, 500 and 1200. A `relaxed` cell reaches
 * 170-240px, which is 340-480 device pixels on the 2× and 3× displays most
 * phones and laptops have — so the 250px asset was being upscaled on the
 * largest grid cells in the product. The delivered bytes barely move, because
 * the optimiser re-encodes to the same rendered width either way; what changes
 * is whether that width was interpolated up from a smaller original.
 *
 * `standard` and `dense` stay on 250: their cells top out around 105px, and a
 * larger source would be thrown away.
 */
const SOURCE = { standard: 250, dense: 250, relaxed: 500 } as const;
const RENDER_PX: Record<GridDensity, number> = { standard: 160, dense: 120, relaxed: 240 };

/**
 * How many leading cells load eagerly — one row at the narrowest breakpoint.
 *
 * **These are the base column counts of the ramp above**, the unprefixed
 * `grid-cols-N` that opens each string, which is by definition the narrowest
 * width because every other entry carries a `min-width` prefix. `priority`
 * exists to mark the LCP element, and the first cell is top-left at every
 * breakpoint, so a small leading set covers it everywhere. Marking a first row
 * at the *widest* breakpoint instead would over-mark on a phone, where only the
 * opening row is visible and the connection is slowest — and a browser
 * deprioritises when everything is high (`design-reference.md` §11.10).
 *
 * **Stated a second time rather than computed, and that is a constraint rather
 * than a preference.** Tailwind only generates classes it can see literally, so
 * an interpolated `grid-cols-${n}` would never be emitted and the grid would
 * silently lose its columns. The number therefore cannot be derived from the
 * string in production — `AlbumGrid.test.ts` pins the two together instead, so
 * moving the ramp without moving this fails rather than drifts.
 */
export const BASE_COLUMNS: Record<GridDensity, number> = { standard: 3, dense: 4, relaxed: 2 };

/** Bare grid shell. Takes any tile, so collection tiles can reuse the geometry. */
export function AlbumGridShell({
  density = 'standard',
  children,
}: {
  density?: GridDensity;
  children: ReactNode;
}) {
  return <ul className={`grid ${DENSITY[density]}`}>{children}</ul>;
}

type Props = {
  albums: AlbumSummary[];
  density?: GridDensity;
  /**
   * Titles beneath each cover.
   *
   * Off by default: the reference's grid is caption-free, and at this density
   * recognition beats reading. Catalogue browse surfaces turn it on while the
   * catalogue is still unfamiliar.
   */
  showCaptions?: boolean;
  /**
   * The artist whose page this grid is on.
   *
   * Suppresses the credit line when it equals this name — printing "Radiohead"
   * under every Radiohead album is noise; printing a credit only when it
   * changes is signal. Leaving it unset means there is no artist context to
   * suppress against, so the credit always shows: on browse or search surfaces
   * a caption without an artist is barely a caption at all.
   *
   * Two different things trip it, and both are worth showing:
   *
   *  - **Collaborations.** Watch the Throne appears on both Jay-Z's and Kanye
   *    West's pages via `album_artists`, and without the credit it would look
   *    like a solo record on each.
   *  - **Renames.** MusicBrainz has renamed Kanye West to Ye, while the cached
   *    `display_credit` still reads as released. Every album on that page
   *    therefore carries a credit line. That is correct: the record really was
   *    credited to Kanye West, and the catalogue is read-only downstream of
   *    MusicBrainz, so the two names legitimately differ.
   */
  creditFor?: string;
  emptyMessage?: string;
};

export function AlbumGrid({
  albums,
  density = 'standard',
  showCaptions = false,
  creditFor,
  emptyMessage = 'Nothing here yet.',
}: Props) {
  if (albums.length === 0) {
    return <p className="py-12 text-center text-sm text-text-muted">{emptyMessage}</p>;
  }

  return (
    <AlbumGridShell density={density}>
      {albums.map((album, index) => (
        <li key={album.id}>
          <Link href={`/albums/${album.mbid}`} className="group block">
            <AlbumCover
              mbid={album.mbid}
              title={album.title}
              hasArtwork={album.artwork_status === 'found'}
              px={RENDER_PX[density]}
              size={SOURCE[density]}
              priority={index < BASE_COLUMNS[density]}
            />
            {showCaptions && (
              <>
                <p
                  className="mt-2 truncate text-xs leading-snug group-hover:underline"
                  title={album.title}
                >
                  {album.title}
                </p>
                {album.display_credit !== creditFor && (
                  <p
                    className="truncate text-[0.7rem] leading-snug text-text-secondary"
                    title={album.display_credit}
                  >
                    {album.display_credit}
                  </p>
                )}
                {album.releaseYear && (
                  <p className="tabular text-[0.7rem] leading-snug text-text-muted">
                    {album.releaseYear}
                    {album.primary_type === 'ep' && ' · EP'}
                  </p>
                )}
              </>
            )}
          </Link>
        </li>
      ))}
    </AlbumGridShell>
  );
}
