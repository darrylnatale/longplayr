import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlbumCover } from '@/components/AlbumCover';
import { getAlbumByMbid } from '@/services/catalogue/queries';

/**
 * Album page.
 *
 * Read-only in Phase 1. Collection controls — add, rate, like, review,
 * relisten — arrive in Phase 2, along with the three-state action card
 * (docs/design-reference.md §6.4).
 */

export async function generateMetadata({ params }: PageProps<'/albums/[mbid]'>) {
  const { mbid } = await params;
  const album = await getAlbumByMbid(mbid);
  if (!album) return { title: 'Not found · longplayr' };
  return { title: `${album.title} by ${album.display_credit} · longplayr` };
}

function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

const TYPE_LABELS: Record<string, string> = { album: 'Album', ep: 'EP', other: 'Release' };

export default async function AlbumPage({ params }: PageProps<'/albums/[mbid]'>) {
  const { mbid } = await params;
  const album = await getAlbumByMbid(mbid);

  if (!album) notFound();

  // Secondary types qualify the primary one: a live album is an Album that is
  // also Live.
  const typeLabel = [
    TYPE_LABELS[album.primary_type] ?? 'Release',
    ...album.secondary_types.map((t) => t.replace('_', '-')),
  ].join(' · ');

  const multiDisc = new Set(album.tracks.map((t) => t.medium_position)).size > 1;

  return (
    <article className="flex flex-col gap-10 md:flex-row md:gap-12">
      <div className="w-full max-w-[260px] shrink-0">
        <AlbumCover
          mbid={album.mbid}
          title={album.title}
          hasArtwork={album.artwork_status === 'found'}
          px={260}
          size={500}
          priority
        />
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="text-3xl font-semibold tracking-tight">{album.title}</h1>

        <p className="mt-2 text-muted">
          {album.artists.length > 0 ? (
            album.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && ', '}
                <Link
                  href={`/artists/${artist.mbid}`}
                  className="text-foreground underline underline-offset-4"
                >
                  {artist.name}
                </Link>
              </span>
            ))
          ) : (
            <span>{album.display_credit}</span>
          )}
        </p>

        <p className="mt-4 text-sm text-muted">
          {typeLabel}
          {album.releaseDateLabel && <> · {album.releaseDateLabel}</>}
          {album.editionCount > 0 && (
            <>
              {' '}
              · {album.editionCount} {album.editionCount === 1 ? 'edition' : 'editions'}
            </>
          )}
        </p>

        {/* Phase 2 replaces this with the collection action card. */}
        <p className="mt-6 rounded border border-border bg-surface px-4 py-3 text-sm text-muted">
          Logging, rating and reviewing arrive in the next phase.
        </p>

        <section className="mt-10">
          <h2 className="mb-3 border-b border-border pb-2 text-xs font-medium uppercase tracking-widest text-muted">
            Tracklist
          </h2>

          {album.tracks.length === 0 ? (
            <p className="py-4 text-sm text-muted">No tracklist available for this release.</p>
          ) : (
            <ol className="text-sm">
              {album.tracks.map((track) => (
                <li
                  key={`${track.medium_position}-${track.position}`}
                  className="flex items-baseline gap-3 border-b border-border/50 py-2 last:border-0"
                >
                  <span className="w-10 shrink-0 tabular-nums text-muted">
                    {multiDisc ? `${track.medium_position}.${track.position}` : track.position}
                  </span>
                  <span className="min-w-0 flex-1">{track.title}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {formatDuration(track.length_ms)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </article>
  );
}
