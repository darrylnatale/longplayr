import Link from 'next/link';

import { AlbumCover } from '@/components/AlbumCover';
import { searchUpstream } from '@/services/catalogue/self-service';
import { getCurrentUser } from '@/services/profiles';
import { searchCatalogue } from '@/services/search';

import { AddFromUpstream } from './AddFromUpstream';

export const metadata = { title: 'Search · longplayr' };

/**
 * Search.
 *
 * Local catalogue first. The MusicBrainz fallback appears beneath, and only
 * when it has something local results do not — a record we do not hold yet,
 * addable in one click. It should read as a feature, not an error
 * (docs/design-reference.md §6.5).
 */
export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';

  const results = query ? await searchCatalogue(query) : null;
  const user = query ? await getCurrentUser() : null;

  // Only consulted when local results are thin — otherwise it is noise, and it
  // spends a request against a one-per-second budget.
  const upstream =
    query && user && (results?.albums.length ?? 0) < 5 ? await searchUpstream(query, 5) : [];

  return (
    <div>
      <form action="/search" className="mb-8">
        <label htmlFor="q" className="sr-only">
          Search albums, artists and people
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="Search albums, artists, people"
          autoFocus
          className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-muted"
        />
      </form>

      {!query && <p className="py-12 text-center text-sm text-muted">Search for a record.</p>}

      {results && (
        <div className="flex flex-col gap-10">
          <section>
            <h2 className="mb-4 border-b border-border pb-2 text-xs font-medium uppercase tracking-widest text-muted">
              Albums
            </h2>
            {results.albums.length === 0 ? (
              <p className="py-4 text-sm text-muted">No albums match “{results.query}”.</p>
            ) : (
              <ul className="flex flex-col">
                {results.albums.map((album) => (
                  <li key={album.id} className="border-b border-border/50 last:border-0">
                    <Link
                      href={`/albums/${album.mbid}`}
                      className="group flex items-center gap-4 py-3"
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
                        <p className="truncate text-sm group-hover:underline">{album.title}</p>
                        <p className="truncate text-xs text-muted">
                          {album.display_credit}
                          {album.releaseYear && ` · ${album.releaseYear}`}
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
              <h2 className="mb-4 border-b border-border pb-2 text-xs font-medium uppercase tracking-widest text-muted">
                Artists
              </h2>
              <ul className="flex flex-col">
                {results.artists.map((artist) => (
                  <li key={artist.id} className="border-b border-border/50 last:border-0">
                    <Link href={`/artists/${artist.mbid}`} className="block py-3 hover:underline">
                      <span className="text-sm">{artist.name}</span>
                      {artist.disambiguation && (
                        <span className="ml-2 text-xs text-muted">{artist.disambiguation}</span>
                      )}
                      <span className="ml-2 text-xs text-muted">
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
              <h2 className="mb-4 border-b border-border pb-2 text-xs font-medium uppercase tracking-widest text-muted">
                People
              </h2>
              <ul className="flex flex-col">
                {results.users.map((person) => (
                  <li key={person.handle} className="border-b border-border/50 last:border-0">
                    <Link href={`/${person.handle}`} className="block py-3 text-sm hover:underline">
                      {person.display_name ?? person.handle}
                      <span className="ml-2 text-xs text-muted">{person.handle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {upstream.length > 0 && (
            <section>
              <h2 className="mb-1 border-b border-border pb-2 text-xs font-medium uppercase tracking-widest text-muted">
                Not in longplayr yet
              </h2>
              <p className="mb-3 mt-2 text-xs text-muted">
                Found in MusicBrainz. Add one to bring it into the catalogue.
              </p>
              <ul className="flex flex-col">
                {upstream.map((candidate) => (
                  <li
                    key={candidate.mbid}
                    className="flex items-center gap-4 border-b border-border/50 py-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{candidate.title}</p>
                      <p className="truncate text-xs text-muted">
                        {candidate.credit}
                        {candidate.year && ` · ${candidate.year}`}
                        {candidate.primaryType && ` · ${candidate.primaryType}`}
                      </p>
                    </div>
                    <AddFromUpstream mbid={candidate.mbid} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
