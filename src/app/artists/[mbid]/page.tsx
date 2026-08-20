import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlbumGrid } from '@/components/AlbumGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getArtistByMbid, type DiscographySort } from '@/services/catalogue/queries';

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
 * **Sorting is by release date only.** Newest first by default, oldest first on
 * request, and undated releases stay last either way. Sorting by rating, and an
 * artist-level aggregate rating, are **deferred** — `product-spec.md` §6 carried
 * both as `[INFERRED]` on the stated premise that they would reuse the
 * collection view's sort machinery. That machinery does not exist, so the
 * premise did not hold, and the question was resolved in favour of date alone
 * rather than built around.
 */

export async function generateMetadata({ params }: PageProps<'/artists/[mbid]'>) {
  const { mbid } = await params;
  const artist = await getArtistByMbid(mbid);
  if (!artist) return { title: 'Not found · longplayr' };
  return { title: `${artist.name} · longplayr` };
}

/**
 * `?sort=` is user input and arrives as anything at all.
 *
 * Anything that is not `oldest` resolves to the default rather than erroring —
 * the same shape as `pageFrom` on the collection destination, and for the same
 * reason: a malformed sort is not worth a 404.
 */
function sortFrom(value: string | string[] | undefined): DiscographySort {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'oldest' ? 'oldest' : 'newest';
}

/**
 * Newest / Oldest, as two links rather than a control with state.
 *
 * The page is server-rendered and the sort lives in the URL, so this needs no
 * client component: each option is the address of the page sorted that way, and
 * the browser's own back button moves between them.
 *
 * Newest is the default, so it is the bare address — the same convention page
 * one uses on the collection destination, where `?page=1` is never written.
 */
function DiscographySortLinks({ mbid, sort }: { mbid: string; sort: DiscographySort }) {
  const options: { value: DiscographySort; label: string; href: string }[] = [
    { value: 'newest', label: 'Newest', href: `/artists/${mbid}` },
    { value: 'oldest', label: 'Oldest', href: `/artists/${mbid}?sort=oldest` },
  ];

  return (
    <span className="flex items-baseline gap-3">
      {options.map((option) =>
        option.value === sort ? (
          <span key={option.value} aria-current="true" className="text-accent">
            {option.label}
          </span>
        ) : (
          <Link
            key={option.value}
            href={option.href}
            className="text-text-muted underline decoration-border-strong underline-offset-4 transition-colors hover:text-text"
          >
            {option.label}
          </Link>
        ),
      )}
    </span>
  );
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

export default async function ArtistPage({ params, searchParams }: PageProps<'/artists/[mbid]'>) {
  const { mbid } = await params;
  const sort = sortFrom((await searchParams).sort);
  const artist = await getArtistByMbid(mbid, sort);

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
        {/*
         * The sort takes the trailing slot, which exists for exactly one
         * right-aligned affordance. The bare count that sat here is not lost —
         * the page header two lines above already reads "N releases", so it was
         * saying the same thing twice.
         */}
        <SectionHeader
          trailing={count > 1 ? <DiscographySortLinks mbid={mbid} sort={sort} /> : undefined}
        >
          Discography
        </SectionHeader>

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
