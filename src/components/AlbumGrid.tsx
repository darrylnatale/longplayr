import Link from 'next/link';

import { AlbumCover } from '@/components/AlbumCover';
import type { AlbumSummary } from '@/services/catalogue/queries';

/**
 * Grid of album covers.
 *
 * Square artwork, not portrait posters — the single largest visual divergence
 * from longplayr's structural reference, and the reason this grid runs denser
 * than a film grid would at the same width (docs/design-reference.md §5.1).
 *
 * Captions are shown here because the catalogue is currently sparse and titles
 * aid recognition. A user's own collection grid will likely drop them.
 */
export function AlbumGrid({ albums }: { albums: AlbumSummary[] }) {
  if (albums.length === 0) {
    return <p className="py-12 text-center text-sm text-muted">Nothing here yet.</p>;
  }

  return (
    <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {albums.map((album) => (
        <li key={album.id}>
          <Link href={`/albums/${album.mbid}`} className="group block">
            <AlbumCover
              mbid={album.mbid}
              title={album.title}
              hasArtwork={album.artwork_status === 'found'}
              px={160}
              size={250}
            />
            <p className="mt-2 truncate text-xs group-hover:underline" title={album.title}>
              {album.title}
            </p>
            {album.releaseYear && (
              <p className="text-xs text-muted">
                {album.releaseYear}
                {album.primary_type === 'ep' && ' · EP'}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
