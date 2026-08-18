import Image from 'next/image';

import { storedArtworkUrl, type ArtworkSize } from '@/services/catalogue/artwork';

/**
 * Album artwork, or a placeholder.
 *
 * Cover Art Archive is our only source and has real gaps, so the placeholder is
 * not an edge case — it is a component many users will see often, especially
 * early on while the catalogue is thin (docs/design-reference.md §6.6).
 *
 * Album art is square, unlike the portrait posters longplayr's structural
 * reference uses. That difference cascades through every grid in the product
 * (docs/design-reference.md §5.1).
 *
 * The corner radius is nearly square on purpose: covers should read as objects
 * on a shelf, not as buttons. The hairline border exists so a pale or
 * white-bordered cover does not bleed into the ground.
 */

type Props = {
  mbid: string;
  title: string;
  size?: ArtworkSize;
  hasArtwork: boolean;
  /** Rendered dimension in px. The fetched asset size is chosen separately. */
  px?: number;
  priority?: boolean;
};

/**
 * A stable, muted tint derived from the MBID.
 *
 * A wall of identical grey squares reads as broken; a wall of subtly different
 * ones reads as intentional. Deterministic so a given album always looks the
 * same, and kept dark and desaturated so placeholders never compete with real
 * artwork sitting beside them.
 */
function placeholderTint(mbid: string): string {
  let hash = 0;
  for (let i = 0; i < mbid.length; i++) {
    hash = (hash * 31 + mbid.charCodeAt(i)) >>> 0;
  }
  // Lightness and saturation are pinned near the warm neutral ramp so a
  // placeholder never out-shouts the real artwork beside it; only hue varies.
  return `hsl(${hash % 360} 10% 12%)`;
}

/** Up to three initials, so long titles stay legible at grid scale. */
function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export function AlbumCover({ mbid, title, size = 500, hasArtwork, px = 200, priority }: Props) {
  if (!hasArtwork) {
    return (
      <div
        className="@container flex aspect-square w-full items-center justify-center rounded-[var(--radius-cover)] border border-border"
        style={{ backgroundColor: placeholderTint(mbid) }}
        role="img"
        aria-label={`${title} — no cover art available`}
      >
        <span className="font-serif text-[clamp(0.85rem,18cqw,2rem)] tracking-widest text-text-faint">
          {initials(title)}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={storedArtworkUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, mbid, size)}
      alt={`${title} cover art`}
      width={px}
      height={px}
      priority={priority}
      className="aspect-square w-full rounded-[var(--radius-cover)] border border-border object-cover"
    />
  );
}
