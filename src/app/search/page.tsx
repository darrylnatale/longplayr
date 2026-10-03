import { Suspense } from 'react';

import Link from 'next/link';

import { AlbumCover } from '@/components/AlbumCover';
import { ArtistCredit } from '@/components/ArtistCredit';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getCurrentUser } from '@/services/profiles';
import { searchCatalogue } from '@/services/search';

import { MIN_UPSTREAM_QUERY_LENGTH, shouldOfferFallback } from './fallback';
import { SearchField } from './SearchField';
import { UpstreamPanel, UpstreamPending } from './UpstreamPanel';
import { albumPath, artistPath } from '@/lib/paths';

export const metadata = { title: 'Search · longplayr' };

/**
 * Raised for the sake of `after()` in `addAlbum`, not for the render.
 *
 * `after` runs inside the route's max duration (Next's `after` documentation),
 * and the work it schedules here is a Cover Art Archive fetch plus three
 * derivative uploads. The platform default is too tight to rely on for that,
 * and a truncated callback silently leaves the job queued for the daily cron.
 */
export const maxDuration = 60;

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

const ROW = 'border-b border-border/50 last:border-0';

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';

  // Both fast, and both awaited here rather than inside the streaming boundary
  // below: the catalogue read is what the page is for, and the session read is
  // what decides whether the boundary is emitted at all.
  const results = query ? await searchCatalogue(query) : null;
  const user = query ? await getCurrentUser() : null;

  // Derived from the catalogue alone. It used to also require that MusicBrainz
  // had returned nothing, which is unknowable now that the upstream request is
  // streamed — and holding the local answer back until both were known was the
  // behaviour this slice exists to remove.
  const nothingLocal =
    results !== null &&
    results.albums.length === 0 &&
    results.artists.length === 0 &&
    results.users.length === 0;

  // No result count reaches this. See `fallback.ts` — the absence is the fix.
  const offerFallback = shouldOfferFallback({ query, isSignedIn: Boolean(user) });

  // Signed-out visitors never get the fallback, because searching MusicBrainz
  // is gated on a session. Saying so beats letting a thin page look like an
  // empty catalogue. This carried the same `< 5` gate and loses it for the same
  // reason: otherwise the two branches disagree about when a fallback would
  // have existed at all.
  /*
   * **The same length threshold as the offer itself.** Otherwise a signed-out
   * visitor is invited to sign in and search MusicBrainz after one character,
   * while a signed-in one gets nothing until three — the two branches
   * advertising different rules for the same capability.
   */
  const fallbackUnavailable = query.trim().length >= MIN_UPSTREAM_QUERY_LENGTH && !user;

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
          <SearchField initialQuery={query} />
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

      {/*
       * Said as soon as the catalogue answers, without waiting for MusicBrainz.
       * The advice that used to sit beneath it for a signed-in reader has moved
       * into `UpstreamPanel`, because "try a different spelling" is the wrong
       * thing to say while a result may still be arriving. The signed-out line
       * stays here: no fallback is coming, so nothing is pending.
       *
       * Bottom padding shrinks when a fallback will follow, so the pending line
       * and the panel do not land marooned below a full-height empty state.
       */}
      {nothingLocal && (
        <div className={`text-center ${offerFallback ? 'pb-6 pt-16' : 'py-16'}`}>
          <p className="font-serif text-xl text-text-secondary">
            Nothing in the catalogue matches “{results.query}”.
          </p>
          {fallbackUnavailable && (
            <p className="mx-auto mt-2 max-w-[46ch] text-sm text-text-muted">
              Sign in to search MusicBrainz and add records that are not in the catalogue yet.
            </p>
          )}
        </div>
      )}

      {results && !nothingLocal && (
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
                  <li key={album.id} className={`${ROW} flex items-center gap-4 py-2.5`}>
                    {/*
                     * **The row is no longer one anchor, and that is deliberate.**
                     * It wrapped cover, title and credit together, so a credit
                     * link would have been an `<a>` inside an `<a>` — invalid
                     * HTML. Cover and title are now separate links to the album
                     * and the metadata line sits beside them
                     * (`design-reference.md` §11.12).
                     *
                     * **This row loses clickable-anywhere, and it costs more
                     * here than in a grid**, because results are scanned and
                     * clicked more freely than covers. Accepted so that one
                     * album does not behave differently depending on which
                     * surface found it.
                     */}
                    <Link href={albumPath(album)} className="w-12 shrink-0">
                      <AlbumCover
                        mbid={album.mbid}
                        title={album.title}
                        hasArtwork={album.artwork_status === 'found'}
                        px={48}
                        size={250}
                      />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <Link href={albumPath(album)} className="group block">
                        <span className="block truncate text-sm text-text group-hover:underline">
                          {album.title}
                        </span>
                      </Link>

                      <p className="truncate text-xs text-text-muted">
                        <ArtistCredit
                          artists={album.artists}
                          fallback={album.display_credit}
                          className="inline"
                        />
                        {album.releaseYear && (
                          <span className="tabular"> · {album.releaseYear}</span>
                        )}
                        {album.primary_type === 'ep' && ' · EP'}
                      </p>
                    </div>
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
                    <Link href={artistPath(artist)} className="group block py-2.5">
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

          {/* Thin local results and no session: explain the missing fallback. */}
          {fallbackUnavailable && (
            <p className="text-xs text-text-faint">
              <Link href="/login" className="text-accent underline underline-offset-4">
                Sign in
              </Link>{' '}
              to search MusicBrainz for records not in the catalogue yet.
            </p>
          )}
        </div>
      )}

      {/*
       * The fallback, streamed. The first Suspense boundary in this repository.
       *
       * Emitted only when the rule says so — so for a signed-out visitor the
       * component never mounts and `searchUpstream` is never called. That is
       * the session decision enforced by the tree's shape rather than by a
       * guard inside the request.
       *
       * Everything above this line has already been sent by the time the
       * upstream request is outstanding, which is the whole of the change.
       */}
      {offerFallback && (
        <div
          /*
           * A live region, because streaming created the need for one. While
           * this section was rendered inline, a screen reader met it in
           * document order like anything else. Now it arrives after the reader
           * may already have passed this point, so its replacement has to be
           * announced or it is simply never discovered.
           *
           * `polite` rather than `assertive`: this is a subordinate section and
           * must not interrupt. The wrapper is the stable element and therefore
           * the one that can carry this — the pending line inside it is
           * replaced, and a live region declared on a node that is removed
           * announces nothing.
           *
           * The pending text itself is deliberately not announced: it is
           * present in the initial HTML, and live regions announce changes
           * rather than initial content. Reading order already covers it.
           */
          aria-live="polite"
          className={nothingLocal ? '' : 'mt-10'}
        >
          <Suspense fallback={<UpstreamPending centred={nothingLocal} />}>
            <UpstreamPanel query={query} nothingLocal={nothingLocal} />
          </Suspense>
        </div>
      )}
    </Container>
  );
}
