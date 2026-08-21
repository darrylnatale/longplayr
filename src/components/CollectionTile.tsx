import Link from 'next/link';

import { AlbumCover } from '@/components/AlbumCover';
import { formatScore } from '@/components/ScoreBadge';

/**
 * A collection grid tile, in one of two modes.
 *
 * **Compact is the collection's presentation everywhere.** An artwork-led
 * record shelf — nothing is burned into the cover, and the wall of squares
 * reads uninterrupted — with a **minimal state line** beneath: score, like
 * indicator and `×N`, each only when it applies.
 *
 * That state line is the difference between a collection and the catalogue
 * (`design-reference.md` §11.9). Browse already shows what exists; a profile
 * exists to show what someone thinks of it, and a wall of covers carrying no
 * score says nothing a catalogue page does not. The line is **not** a caption
 * and does not reopen §11.5: that decision ties title and credit to `relaxed`
 * cells because `standard` tops out near 105px where a credit is unreadable.
 * `9.6`, a heart and `×3` are three characters, a glyph and two characters in
 * tabular figures, which are legible at that size where a credit is not.
 *
 * Detailed adds title and credit on top, and is not currently used by any
 * product surface — it stays in the design system and the gallery.
 *
 * Detailed keeps a strict hierarchy, and the order is the whole point:
 *
 *   1. artwork
 *   2. title and credit
 *   3. collection state — score, like, relistens
 *
 * Collection state is deliberately the quietest line, set as a single inline
 * run rather than a justified row of stats. A tile should read as a record with
 * a caption, never as a dashboard cell.
 *
 * Rejected alternatives, recorded so they are not revisited by accident:
 * gradient overlays burned onto the artwork (unreadable against dark covers,
 * and they damage the wall), a permanent indicator band beneath every tile
 * (imposes the cost on people who never asked for it), and hover-reveal as a
 * layout (invisible on touch, so collection state would be unknowable). Hover
 * may later *enhance* Detailed, but must never be required to understand state.
 *
 * **The whole tile is a link to the album.** It was not, for far longer than it
 * should have been: `AlbumGrid` wrapped every cell in one from the start, so
 * albums were reachable from the artist page and from Browse but not from the
 * two surfaces where someone looks at their own collection. A grid of records
 * you cannot open is a dead end.
 *
 * **Quick actions on hover are recorded direction, not built** — see
 * `product-spec.md` §10.6. They do not reopen the rejection above, because
 * reading state stays the state line's job; but they raise the same touch
 * problem for *acting*, and that question is unanswered by design.
 */

export type CollectionMode = 'compact' | 'detailed';

export type TileAlbum = {
  mbid: string;
  title: string;
  credit: string;
  /**
   * Null when the catalogue holds no release date. Not currently rendered in
   * either mode — it is carried so a tile can show a year without the caller
   * having to re-query, and widened to nullable so real collection data can be
   * mapped without inventing a year the catalogue does not hold.
   */
  year: number | null;
  hasArtwork: boolean;
  score: number | null;
  liked: boolean;
  relistens: number;
};

function HeartGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 text-like" fill="currentColor">
      <path d="M8 14s-5.5-3.6-5.5-7A3 3 0 0 1 8 5.2 3 3 0 0 1 13.5 7c0 3.4-5.5 7-5.5 7z" />
    </svg>
  );
}

/**
 * The third line of the hierarchy.
 *
 * Renders nothing at all when there is nothing to say — an unrated, unliked,
 * never-relistened album gets no empty row reserved for it, which is what stops
 * a sparse collection looking like a broken table.
 */
function CollectionState({ album }: { album: TileAlbum }) {
  const showScore = album.score !== null;
  const showRelistens = album.relistens > 1;
  if (!showScore && !album.liked && !showRelistens) return null;

  return (
    <p className="mt-1 flex items-center gap-2 leading-none">
      {showScore && (
        <span className="tabular text-[0.7rem] text-text-secondary">
          {formatScore(album.score as number)}
        </span>
      )}
      {album.liked && <HeartGlyph />}
      {showRelistens && (
        <span className="tabular text-[0.7rem] text-text-muted">×{album.relistens}</span>
      )}
      <span className="sr-only">
        {showScore ? `scored ${formatScore(album.score as number)}. ` : ''}
        {album.liked ? 'Liked. ' : ''}
        {showRelistens ? `Relistened ${album.relistens} times.` : ''}
      </span>
    </p>
  );
}

export function CollectionTile({ album, mode }: { album: TileAlbum; mode: CollectionMode }) {
  const cover = (
    <AlbumCover
      mbid={album.mbid}
      title={album.title}
      hasArtwork={album.hasArtwork}
      px={mode === 'detailed' ? 200 : 160}
      size={250}
    />
  );

  // Compact renders the cover and, only when there is something to say, the
  // state line. `CollectionState` returns null for an unrated, unliked, never
  // relistened album, so no empty row is reserved and a sparse collection still
  // reads as an uninterrupted wall rather than a broken table.
  if (mode === 'compact')
    return (
      <Link href={`/albums/${album.mbid}`} className="group block">
        {cover}
        <CollectionState album={album} />
      </Link>
    );

  return (
    <Link href={`/albums/${album.mbid}`} className="group block">
      {cover}
      <p
        className="mt-2 truncate text-xs leading-snug text-text group-hover:underline"
        title={album.title}
      >
        {album.title}
      </p>
      <p className="truncate text-[0.7rem] leading-snug text-text-muted" title={album.credit}>
        {album.credit}
      </p>
      <CollectionState album={album} />
    </Link>
  );
}
