import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActionCard, type ActionCardState } from '@/components/ActionCard';
import { AlbumCover } from '@/components/AlbumCover';
import { Container } from '@/components/Container';
import { ScoreBadge } from '@/components/ScoreBadge';
import { SectionHeader } from '@/components/SectionHeader';
import { getAlbumByMbid } from '@/services/catalogue/queries';
import { getMyCollectionState } from '@/services/collection';
import { getAlbumRating } from '@/services/collection/ratings';
import { getAlbumReviews } from '@/services/collection/reviews';
import { Avatar } from '@/components/Avatar';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

import {
  addAlbumAction,
  deleteReviewAction,
  markRelistenAction,
  rateAlbumAction,
  removeAlbumAction,
  saveReviewAction,
  toggleLikeAction,
} from './actions';

/**
 * Album page — the canonical detail composition.
 *
 * Three columns, per docs/design-reference.md §3: identity (artwork), content
 * (metadata and tracklist), and personal action. The proportions differ from
 * the reference because our artwork is square rather than 2:3 portrait — a
 * 13%-wide square would be too small to carry the page, so the artwork column
 * is wider and the centre measure correspondingly tighter.
 *
 * DOM order is the mobile order: artwork, identity, action, tracklist. Desktop
 * placement is done with explicit grid positions rather than by reordering, so
 * the action card never ends up below the tracklist on a phone — which is what
 * a naive three-column source order would produce.
 *
 * Read-only. The action card is a presentation shell; Phase 2 wires it.
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

/** Total runtime, shown beside the tracklist header. */
function formatRuntime(totalMs: number): string {
  const minutes = Math.round(totalMs / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

const TYPE_LABELS: Record<string, string> = { album: 'Album', ep: 'EP', other: 'Release' };

/**
 * Which card to show.
 *
 * Derived entirely from real session and collection state, so the page tells
 * the truth about who is looking at it and what they hold. The two states that
 * precede collection are not edge cases: signed out is the common case for a
 * public catalogue, and authenticated-without-a-handle is a real position a
 * user can sit in, because user-authored rows reference `profiles(id)`.
 *
 * The rated state is rendered but not yet reachable through the interface —
 * rating arrives in its own slice. Rendering it correctly now costs nothing and
 * means an entry rated through the service layer does not display as unrated.
 */
async function resolveActionState(albumId: string): Promise<ActionCardState> {
  const user = await getCurrentUser();
  if (!user) return { kind: 'signed-out' };

  const profile = await getCurrentProfile();
  if (!profile) return { kind: 'onboarding-required' };

  const { entry, review } = await getMyCollectionState(albumId);
  if (!entry) return { kind: 'not-collected' };

  const relistens = entry.relisten_count;

  // `rating` is nullable and 0.0 is a real score, so this must test for null
  // rather than for falsiness — `entry.rating ? …` would render a zero-rated
  // album as unrated.
  if (entry.rating !== null) {
    return {
      kind: 'collected-rated',
      score: Number(entry.rating),
      liked: entry.liked,
      relistens,
      hasReview: review !== null,
      reviewBody: review?.body ?? null,
      reviewUpdatedAt: review?.updated_at ?? null,
    };
  }

  return {
    kind: 'collected-unrated',
    liked: entry.liked,
    relistens,
    hasReview: review !== null,
    reviewBody: review?.body ?? null,
    reviewUpdatedAt: review?.updated_at ?? null,
  };
}

export default async function AlbumPage({ params }: PageProps<'/albums/[mbid]'>) {
  const { mbid } = await params;
  const album = await getAlbumByMbid(mbid);

  if (!album) notFound();

  const actionState = await resolveActionState(album.id);

  // Computed on read from non-null ratings, never stored. Deletion therefore
  // needs no recomputation step, and no counter can drift.
  const rating = await getAlbumRating(album.id);

  // Live reviews only — removed ones are excluded by the query, and their
  // author keeps access through RLS rather than through this page. The
  // caller's own review is dropped because it already has a home in the action
  // card, and printing it twice would read as a duplicate rather than a list.
  const viewer = await getCurrentProfile();
  const reviews = (await getAlbumReviews(album.id)).filter(
    (review) => review.author.id !== viewer?.id,
  );

  // Secondary types qualify the primary one: a live album is an Album that is
  // also Live.
  const typeLabel = [
    TYPE_LABELS[album.primary_type] ?? 'Release',
    ...album.secondary_types.map((t) => t.replace('_', '-')),
  ].join(' · ');

  const multiDisc = new Set(album.tracks.map((t) => t.medium_position)).size > 1;
  const runtimeMs = album.tracks.reduce((sum, t) => sum + (t.length_ms ?? 0), 0);

  return (
    <Container variant="content">
      <article className="grid gap-8 lg:grid-cols-[minmax(200px,240px)_minmax(0,1fr)_minmax(240px,280px)] lg:items-start lg:gap-10">
        {/* Identity. Spans both rows on desktop so the tracklist runs beside it. */}
        <div className="w-full max-w-[240px] lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:max-w-none">
          <AlbumCover
            mbid={album.mbid}
            title={album.title}
            hasArtwork={album.artwork_status === 'found'}
            px={280}
            size={500}
            priority
          />
        </div>

        {/* Title block. */}
        <header className="min-w-0 lg:col-start-2 lg:row-start-1">
          <h1 className="font-serif text-3xl leading-[1.15] text-text sm:text-4xl">
            {album.title}
          </h1>

          <p className="mt-2 text-lg text-text-secondary">
            {album.artists.length > 0 ? (
              album.artists.map((artist, index) => (
                <span key={artist.id}>
                  {index > 0 && <span className="text-text-muted">, </span>}
                  <Link
                    href={`/artists/${artist.mbid}`}
                    className="underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-accent"
                  >
                    {artist.name}
                  </Link>
                </span>
              ))
            ) : (
              <span>{album.display_credit}</span>
            )}
          </p>

          <p className="mt-4 text-sm text-text-muted">
            {typeLabel}
            {album.releaseDateLabel && <> · {album.releaseDateLabel}</>}
            {album.editionCount > 0 && (
              <>
                {' '}
                · {album.editionCount} {album.editionCount === 1 ? 'edition' : 'editions'}
              </>
            )}
          </p>
        </header>

        {/* Personal action, and the album's aggregate. */}
        {/*
         * Capped until the sidebar exists. Stacked, an uncapped card stretches
         * to the full 1120px measure and the primary button reads as a banner
         * rather than a control. On a phone the cap is wider than the viewport,
         * so it has no effect there.
         */}
        <aside className="flex max-w-sm flex-col gap-6 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:max-w-none">
          <ActionCard
            state={actionState}
            actions={{
              add: addAlbumAction.bind(null, album.id),
              remove: removeAlbumAction.bind(null, album.id),
              rate: rateAlbumAction.bind(null, album.id),
              like: toggleLikeAction.bind(null, album.id),
              relisten: markRelistenAction.bind(null, album.id),
              saveReview: saveReviewAction.bind(null, album.id),
              deleteReview: deleteReviewAction.bind(null, album.id),
            }}
          />

          <div>
            <SectionHeader as="h3">Rating</SectionHeader>
            {/*
             * The average is a bare numeral and the user's own score is a
             * bordered chip carrying the accent. That separation is the whole
             * point of `ScoreBadge`'s two variants: yours is a statement, the
             * average is a fact, and colour is never used to encode value
             * (docs/design-reference.md §6.2).
             *
             * An album nobody has rated says so plainly. This is the real
             * thin-data state, not a stand-in for one.
             */}
            {rating.average === null ? (
              <>
                <p className="text-sm text-text-muted">Not yet rated.</p>
                <p className="mt-1 text-xs text-text-faint">
                  Scores appear once people start rating this album.
                </p>
              </>
            ) : (
              <ScoreBadge score={rating.average} variant="average" size="lg" count={rating.count} />
            )}
          </div>
        </aside>

        {/* Tracklist. */}
        <section className="min-w-0 lg:col-start-2 lg:row-start-2">
          <SectionHeader trailing={runtimeMs > 0 ? formatRuntime(runtimeMs) : undefined}>
            Tracklist
          </SectionHeader>

          {album.tracks.length === 0 ? (
            <p className="py-4 text-sm text-text-muted">No tracklist available for this release.</p>
          ) : (
            <ol className="text-sm">
              {album.tracks.map((track) => (
                <li
                  key={`${track.medium_position}-${track.position}`}
                  className="flex items-baseline gap-4 border-b border-border/50 py-2.5 last:border-0"
                >
                  <span className="tabular w-8 shrink-0 text-right text-xs text-text-faint">
                    {multiDisc ? `${track.medium_position}.${track.position}` : track.position}
                  </span>
                  <span className="min-w-0 flex-1 text-text-secondary">{track.title}</span>
                  <span className="tabular shrink-0 text-xs text-text-faint">
                    {formatDuration(track.length_ms)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/*
         * Reviews from other people.
         *
         * Rendered as plain text with `whitespace-pre-wrap`: line breaks
         * survive, and React escapes the content. There is deliberately no
         * Markdown, no autolinking and no `dangerouslySetInnerHTML` anywhere
         * near this — it is the first free-text input in the product and the
         * only safe way to render it is not to interpret it.
         */}
        {reviews.length > 0 && (
          <section className="min-w-0 lg:col-start-2 lg:row-start-3">
            <SectionHeader trailing={`${reviews.length}`}>Reviews</SectionHeader>
            <ul className="flex flex-col divide-y divide-border/60">
              {reviews.map((review) => (
                <li key={review.id} className="py-5 first:pt-3">
                  <div className="flex items-center gap-3">
                    <Avatar
                      handle={review.author.handle}
                      displayName={review.author.displayName}
                      url={review.author.avatarUrl}
                      px={32}
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/${review.author.handle}`}
                        className="text-sm text-text underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-accent"
                      >
                        {review.author.displayName ?? review.author.handle}
                      </Link>
                    </div>
                    {/* Their score sits with their words: a review reads very
                        differently next to the number its author gave. */}
                    <ScoreBadge score={review.rating} variant="user" size="sm" />
                  </div>

                  <p className="mt-3 whitespace-pre-wrap font-serif text-base leading-[1.65] text-text-secondary">
                    {review.body}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </Container>
  );
}
