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

/**
 * Up to three initials, so long titles stay legible at grid scale.
 *
 * **Script-agnostic, and it has to be.** An earlier version filtered words
 * with `/[a-z0-9]/i` before taking their first letter, so a title containing no
 * ASCII letters or digits produced an **empty string** and the placeholder drew
 * a tinted square with nothing on it. That silently affected Japanese, Chinese,
 * Korean, Cyrillic, Greek and Arabic titles alike — every script the catalogue
 * actually contains except the one the regex was written for.
 *
 * Three properties this must keep:
 *
 *  - **Any non-empty title yields at least one glyph.** A title of pure
 *    punctuation is a real case — `!!!` is a band — so when nothing matches as
 *    a letter or number, the first character stands in rather than nothing.
 *  - **Codepoints, not code units.** `word[0]` splits a surrogate pair and
 *    renders a broken glyph for anything outside the BMP.
 *  - **Scripts without spaces get one character**, not three, because there is
 *    only ever one "word" to take an initial from. That is the right answer:
 *    the first character of 「ゆらゆら帝国」 identifies it; the first three do
 *    not identify it better.
 *
 * `toUpperCase` is a no-op for CJK and correct for Cyrillic and Greek.
 */
export function initials(title: string): string {
  const words = title.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));

  const picked = words
    .slice(0, 3)
    .map((word) => [...word][0]?.toUpperCase() ?? '')
    .join('');

  // Nothing read as a letter or a number — take whatever the title does start
  // with rather than rendering an empty placeholder.
  return picked || ([...title.trim()][0] ?? '');
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
