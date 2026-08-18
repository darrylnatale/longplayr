import { AlbumGridShell } from '@/components/AlbumGrid';
import { CollectionTile, type CollectionMode, type TileAlbum } from '@/components/CollectionTile';

/**
 * A collection, in one of two densities the user chooses between.
 *
 * Mode and geometry are bound together here rather than passed independently,
 * because they are one decision. Detailed tiles carry a title and a credit, and
 * a title under a 105px cell is unreadable — so switching to Detailed also
 * relaxes the column ramp to buy the room the text needs. Letting a caller pair
 * `detailed` with the shelf density would produce exactly the cramped,
 * dashboard-like grid this mode is supposed to avoid.
 *
 * Compact is the default everywhere. Detailed is opt-in.
 */

export const DEFAULT_COLLECTION_MODE: CollectionMode = 'compact';

export function CollectionGrid({
  albums,
  mode = DEFAULT_COLLECTION_MODE,
  emptyMessage = 'Nothing here yet.',
}: {
  albums: TileAlbum[];
  mode?: CollectionMode;
  emptyMessage?: string;
}) {
  if (albums.length === 0) {
    return <p className="py-12 text-center text-sm text-text-muted">{emptyMessage}</p>;
  }

  return (
    <AlbumGridShell density={mode === 'detailed' ? 'relaxed' : 'standard'}>
      {albums.map((album) => (
        <li key={album.mbid}>
          <CollectionTile album={album} mode={mode} />
        </li>
      ))}
    </AlbumGridShell>
  );
}
