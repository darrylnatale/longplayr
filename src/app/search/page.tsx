import Link from 'next/link';

import { AlbumCover } from '@/components/AlbumCover';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { searchUpstream } from '@/services/catalogue/self-service';
import { getCurrentUser } from '@/services/profiles';
import { searchCatalogue } from '@/services/search';

import { AddFromUpstream } from './AddFromUpstream';

export const metadata = { title: 'Search · longplayr' };

/**
 * Search — a scanning surface.
 *
 * Rows rather than a grid, deliberately. Results are **ranked** and they cross
 * entity types, so vertical order carries meaning that a wall of covers would
 * throw away, and an artist or a person has no artwork to tile. The content
 * container is right for the same reason: a row list stretched to the grid
 * width would put a 40px cover at one end of the screen and a year at the other.
 *
 * Local catalogue first. The MusicBrainz fallback sits beneath, and only when
 * local results are thin — it should read as a feature, not an error
 * (docs/design-reference.md §6.5).
 *
 * Search behaviour, ranking, the fallback threshold and the add flow are
 * untouched; this is presentation only.
 */

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Stands in for the cover an upstream candidate does not have.
 *
 * Keeps the row aligned with catalogue results without impersonating one: a
 * dashed outline and a plus read as "could be added", where a grey square would
 * read as "cover missing" and imply we already hold the record.
 */
function AddSlot() {
  return (
    <div
      aria-hidden
      className="flex aspect-square w-12 shrink-0 items-center justify-center rounded-[var(--radius-cover)] border border-dashed border-border-strong text-text-faint"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
      </svg>
    </div>
  );
}

const ROW = 'border-b border-border/50 last:border-0';

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';

  const results = query ? await searchCatalogue(query) : null;
  const user = query ? await getCurrentUser() : null;

  // Only consulted when local results are thin — otherwise it is noise, and it
  // spends a request against a one-per-second budget.
  const upstream =
    query && user && (results?.albums.length ?? 0) < 5 ? await searchUpstream(query, 5) : [];

  const nothingLocal =
    results !== null &&
    results.albums.length === 0 &&
    results.artists.length === 0 &&
    results.users.length === 0;
  const nothingAtAll = nothingLocal && upstream.length === 0;

  // Signed-out visitors never get the fallback, because searching MusicBrainz
  // is gated on a session. Saying so beats letting a thin page look like an
  // empty catalogue.
  const fallbackUnavailable = Boolean(query) && !user && (results?.albums.length ?? 0) < 5;

  return (
    <Container variant="content">
      <form action="/search" className="mb-10">
        <label htmlFor="q" className="sr-only">
          Search albums, artists and people
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
            <SearchIcon />
          </span>
          <input
            id="q"
            name="q"
            defaultValue={query}
            placeholder="Search albums, artists, people"
            autoFocus
            className="w-full rounded-md border border-border bg-surface py-3 pl-11 pr-4 text-base text-text outline-none transition-colors placeholder:text-text-faint focus:border-accent-dim"
          />
        </div>
      </form>

      {!query && (
        <div className="py-16 text-center">
          <p className="font-serif text-xl text-text-secondary">Search for a record.</p>
          <p className="mx-auto mt-2 max-w-[42ch] text-sm text-text-muted">
            Albums, artists and people. If a record is not in the catalogue yet, you can add it from
            MusicBrainz.
          </p>
        </div>
      )}

      {nothingAtAll && (
        <div className="py-16 text-center">
          <p className="font-serif text-xl text-text-secondary">
            Nothing matches “{results.query}”.
          </p>
          <p className="mx-auto mt-2 max-w-[46ch] text-sm text-text-muted">
            {fallbackUnavailable
              ? 'Sign in to search MusicBrainz and add records that are not in the catalogue yet.'
              : 'Try a different spelling, or search for the artist instead.'}
          </p>
        </div>
      )}

      {results && !nothingAtAll && (
        <div className="flex flex-col gap-10">
          <section>
            <SectionHeader
              trailing={results.albums.length > 0 ? `${results.albums.length}` : undefined}
            >
              Albums
            </SectionHeader>
            {results.albums.length === 0 ? (
              <p className="py-3 text-sm text-text-muted">No albums match “{results.query}”.</p>
            ) : (
              <ul className="flex flex-col">
                {results.albums.map((album) => (
                  <li key={album.id} className={ROW}>
                    <Link
                      href={`/albums/${album.mbid}`}
                      className="group flex items-center gap-4 py-2.5"
                    >
                      <div className="w-12 shrink-0">
                        <AlbumCover
                          mbid={album.mbid}
                          title={album.title}
                          hasArtwork={album.artwork_status === 'found'}
                          px={48}
                          size={250}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-text group-hover:underline">
                          {album.title}
                        </p>
                        <p className="truncate text-xs text-text-muted">
                          {album.display_credit}
                          {album.releaseYear && (
                            <span className="tabular"> · {album.releaseYear}</span>
                          )}
                          {album.primary_type === 'ep' && ' · EP'}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {results.artists.length > 0 && (
            <section>
              <SectionHeader trailing={`${results.artists.length}`}>Artists</SectionHeader>
              <ul className="flex flex-col">
                {results.artists.map((artist) => (
                  <li key={artist.id} className={ROW}>
                    <Link href={`/artists/${artist.mbid}`} className="group block py-2.5">
                      <span className="text-sm text-text group-hover:underline">{artist.name}</span>
                      {artist.disambiguation && (
                        <span className="ml-2 text-xs text-text-muted">
                          {artist.disambiguation}
                        </span>
                      )}
                      <span className="ml-2 text-xs text-text-faint">
                        · {artist.album_count} {artist.album_count === 1 ? 'release' : 'releases'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.users.length > 0 && (
            <section>
              <SectionHeader trailing={`${results.users.length}`}>People</SectionHeader>
              <ul className="flex flex-col">
                {results.users.map((person) => (
                  <li key={person.handle} className={ROW}>
                    <Link href={`/${person.handle}`} className="group block py-2.5 text-sm">
                      <span className="text-text group-hover:underline">
                        {person.display_name ?? person.handle}
                      </span>
                      <span className="ml-2 text-xs text-text-muted">{person.handle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/*
           * Set inside a panel so the boundary is structural rather than a
           * heading you might skim past. These are not catalogue records — they
           * are records we could hold — and the page should not let the two
           * blur. Subordinate by placement and by weight: last, quieter ground,
           * no artwork.
           */}
          {upstream.length > 0 && (
            <section className="rounded-md border border-border bg-surface/50 p-4 sm:p-5">
              <SectionHeader as="h3">Not in longplayr yet</SectionHeader>
              <p className="-mt-1 mb-2 text-xs text-text-muted">
                Found in MusicBrainz. Adding one brings it into the catalogue for everyone.
              </p>
              <ul className="flex flex-col">
                {upstream.map((candidate) => (
                  <li key={candidate.mbid} className={`flex items-center gap-4 py-2.5 ${ROW}`}>
                    <AddSlot />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-secondary">{candidate.title}</p>
                      <p className="truncate text-xs text-text-muted">
                        {candidate.credit}
                        {candidate.year && <span className="tabular"> · {candidate.year}</span>}
                        {candidate.primaryType && ` · ${candidate.primaryType}`}
                      </p>
                    </div>
                    <AddFromUpstream mbid={candidate.mbid} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Thin local results and no session: explain the missing fallback. */}
          {fallbackUnavailable && !nothingAtAll && (
            <p className="text-xs text-text-faint">
              <Link href="/login" className="text-accent underline underline-offset-4">
                Sign in
              </Link>{' '}
              to search MusicBrainz for records not in the catalogue yet.
            </p>
          )}
        </div>
      )}
    </Container>
  );
}
