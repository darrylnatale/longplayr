import Link from 'next/link';

import type { CreditedArtist } from '@/services/catalogue/credit';
import { artistPath } from '@/lib/paths';

/**
 * An album's credit, as links to the artists it names.
 *
 * **Shared because the alternative is two copies of one product rule.** A grid
 * caption and a ranked list row both print a credit, and `product-spec.md` §6
 * makes a printed credit a route to the artist on every surface that prints
 * one. Two implementations would drift, and the drift would be invisible —
 * each surface looks right on its own.
 *
 * **This component holds no rule.** Which artists, in what order, and which are
 * linkable are all decided in `services/catalogue/credit.ts`; what is left here
 * is what a link looks like. That split is `CLAUDE.md`'s test for where domain
 * logic lives, applied deliberately rather than by accident.
 *
 * **It renders a `<span>`, deliberately, and callers supply `block`.** A `<p>`
 * would be invalid inside the list row's `<span className="min-w-0 flex-1">`
 * wrapper — flow content inside phrasing content, which browsers silently
 * reparent and React can then mismatch on hydration. **That is the same class
 * of defect as the nested anchor this cycle exists to fix**, found at review
 * after the element type was changed without the surrounding markup being
 * checked. A `<span>` is valid in both call sites; a `<p>` is valid in only one.
 */
export function ArtistCredit({
  artists,
  fallback,
  className,
}: {
  artists: CreditedArtist[];
  /**
   * `display_credit`, printed when no artist rows came back.
   *
   * **The album page has always done this and this matches it.** An album with
   * no `album_artists` rows is credited to somebody — we simply have only the
   * flat string for them — so printing nothing would lose real information.
   */
  fallback: string;
  className?: string;
}) {
  if (artists.length === 0) {
    return (
      <span className={className} title={fallback}>
        {fallback}
      </span>
    );
  }

  return (
    <span className={className} title={artists.map((artist) => artist.name).join(', ')}>
      {artists.map((artist, index) => (
        <span key={artist.id}>
          {index > 0 && <span className="text-text-muted">, </span>}
          {/*
           * A pseudo-artist is named but not linked (`product-spec.md` §6).
           * Rendering it as plain text rather than dropping it matters: a
           * compilation credited to nobody would be worse than one credited to
           * "Various Artists" with nowhere to go.
           */}
          {artist.linkable ? (
            <Link href={artistPath(artist)} className="hover:text-accent hover:underline">
              {artist.name}
            </Link>
          ) : (
            artist.name
          )}
        </span>
      ))}
    </span>
  );
}
