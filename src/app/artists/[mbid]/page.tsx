import { notFound } from 'next/navigation';

import { AlbumGrid } from '@/components/AlbumGrid';
import { getArtistByMbid } from '@/services/catalogue/queries';

/**
 * Artist page.
 *
 * The discography is one interleaved chronological run, newest first — albums,
 * EPs and mixtapes together, never grouped by type (docs/product-spec.md §6).
 *
 * Sorting controls and aggregate rating arrive with Phase 2, when there are
 * ratings to sort by.
 */

export async function generateMetadata({ params }: PageProps<'/artists/[mbid]'>) {
  const { mbid } = await params;
  const artist = await getArtistByMbid(mbid);
  if (!artist) return { title: 'Not found · longplayr' };
  return { title: `${artist.name} · longplayr` };
}

export default async function ArtistPage({ params }: PageProps<'/artists/[mbid]'>) {
  const { mbid } = await params;
  const artist = await getArtistByMbid(mbid);

  if (!artist) notFound();

  return (
    <div>
      <header className="border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{artist.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {artist.disambiguation && <span>{artist.disambiguation} · </span>}
          {artist.type ?? 'Artist'} · {artist.albums.length}{' '}
          {artist.albums.length === 1 ? 'release' : 'releases'}
        </p>
      </header>

      <section className="mt-8">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted">
          Discography
        </h2>
        <AlbumGrid albums={artist.albums} />
      </section>
    </div>
  );
}
