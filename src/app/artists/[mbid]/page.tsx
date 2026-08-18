import { notFound } from 'next/navigation';

import { AlbumGrid } from '@/components/AlbumGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getArtistByMbid } from '@/services/catalogue/queries';

/**
 * Artist page — the canonical discography composition.
 *
 * Where the album page is a detail surface, this is a **browse** surface, so it
 * takes the wide container and the grid is the page rather than a section of
 * it. The reference under-serves us badly here: its director page is a thin
 * filmography because filmography is not how people browse film, whereas
 * discography is exactly how people browse music (design-reference.md §5.4).
 *
 * The discography is one interleaved chronological run, newest first — albums,
 * EPs and mixtapes together, never grouped by type (product-spec.md §6). That
 * ordering is done in the query and deliberately not re-sorted here.
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

/** Earliest and latest dated release, when there are enough to describe a span. */
function activeSpan(dates: (string | null)[]): string | null {
  const years = dates
    .filter((d): d is string => Boolean(d))
    .map((d) => d.slice(0, 4))
    .sort();
  if (years.length < 2) return null;
  const [first, last] = [years[0], years[years.length - 1]];
  return first === last ? first : `${first}–${last}`;
}

export default async function ArtistPage({ params }: PageProps<'/artists/[mbid]'>) {
  const { mbid } = await params;
  const artist = await getArtistByMbid(mbid);

  if (!artist) notFound();

  const count = artist.albums.length;
  const span = activeSpan(artist.albums.map((a) => a.first_release_date));

  return (
    <Container variant="wide">
      <header className="border-b border-border pb-6">
        <h1 className="font-serif text-3xl leading-[1.15] text-text sm:text-4xl">{artist.name}</h1>

        {artist.disambiguation && (
          <p className="mt-2 text-base text-text-secondary">{artist.disambiguation}</p>
        )}

        <p className="mt-3 text-sm text-text-muted">
          {artist.type ?? 'Artist'} · {count} {count === 1 ? 'release' : 'releases'}
          {span && <> · {span}</>}
        </p>
      </header>

      <section className="mt-8">
        <SectionHeader trailing={count > 0 ? `${count}` : undefined}>Discography</SectionHeader>

        {/*
         * Captions are on, and the density relaxed to make room for them. This
         * follows the collection grid's Detailed convention: metadata has to buy
         * the space it needs rather than being crammed under a shelf-density
         * cell. It matters more here than on a browse wall — a discography is
         * read chronologically, and the year is half the point.
         *
         * `creditFor` shows the credit whenever it differs from this artist's
         * current name. That keeps collaborations legible — Watch the Throne
         * reads as Jay-Z & Kanye West on both of their pages rather than looking
         * like a solo record on each — and it also surfaces upstream renames,
         * since albums credited to Kanye West sit under an artist MusicBrainz
         * now calls Ye. Both are worth saying out loud.
         */}
        <AlbumGrid
          albums={artist.albums}
          density="relaxed"
          showCaptions
          creditFor={artist.name}
          emptyMessage="No releases in the catalogue yet."
        />
      </section>
    </Container>
  );
}
