import Link from 'next/link';

import { AlbumCover } from '@/components/AlbumCover';
import { AlbumGridShell } from '@/components/AlbumGrid';
import type { FavouriteListItem } from '@/services/collection/favourites';

/**
 * The favourites row — up to ten pinned albums, in the order their owner chose.
 *
 * **Not a new grid.** It composes `AlbumGridShell`, which is where density is
 * defined and where it stays; this file adds no columns, no ramp and no
 * geometry of its own.
 *
 * **`relaxed`, because favourites lead the profile.** `design-reference.md`
 * §11.5 decides that a page stacking more than one grid ranks its sections by
 * density from the existing ramp — `relaxed` for the lead, `standard` for what
 * follows — and that importance is never signalled by a badge, a rule weight or
 * a colour. Favourites sit above the collection preview, so favourites take the
 * larger cell and the collection keeps the shelf. That size difference is the
 * whole of the visual distinction between the two rows, deliberately.
 *
 * **No captions and no position numbers.** §11.5 permits captions under
 * `relaxed` cells; it does not require them, and a favourite needs no title to
 * make its point. The order *is* the ordering — numbering the covers would be
 * exactly the badge that decision rules out.
 *
 * Ten items at `relaxed` wrap rather than holding one line at every width: five
 * across at tablet, seven at desktop. `design-reference.md` §3 anticipated this
 * when it recorded that ten favourites "reads as a grid rather than a single
 * row".
 *
 * A `ul` rather than an `ol` — the positions arrange the covers, they do not
 * rank them. Nothing in the spec says the first favourite is the best one.
 */
export function FavouriteRow({ albums }: { albums: FavouriteListItem[] }) {
  return (
    <AlbumGridShell density="relaxed">
      {albums.map((album) => (
        <li key={album.favouriteId}>
          <Link href={`/albums/${album.mbid}`} className="group block">
            <AlbumCover
              mbid={album.mbid}
              title={album.title}
              hasArtwork={album.hasArtwork}
              // Matches what every other `relaxed` grid draws (§11.6): the 500px
              // asset, so the largest cells on the page are not interpolated up
              // from a smaller original.
              px={240}
              size={500}
            />
          </Link>
        </li>
      ))}
    </AlbumGridShell>
  );
}
