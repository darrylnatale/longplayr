import { isPseudoArtist } from './artist-depth';

/**
 * Who an album is credited to, shaped for rendering.
 *
 * **This is domain logic and not presentation.** `CLAUDE.md`'s test is whether
 * a native client would need the rule to behave correctly, and it would: which
 * artists a credit resolves to, in what order, and which of them are a route to
 * a page are all facts about the catalogue rather than about the web. The
 * component decides what a link *looks* like and nothing else.
 *
 * **The rule this serves:** `product-spec.md` §6, *Reaching an artist from a
 * credit*. A printed credit is a route to the artist on every surface that
 * prints one, and the album page's existing treatment is the model.
 */

/** One credited artist, and whether the credit is a route to them. */
export type CreditedArtist = {
  id: string;
  mbid: string;
  name: string;
  /**
   * False for a pseudo-artist. **Not a filter** — the name is still printed,
   * it simply is not a link, which is why this is a flag on the artist rather
   * than an absence from the list. Dropping `Various Artists` from a credit
   * would leave a compilation credited to nobody.
   */
  linkable: boolean;
};

/** The embed shape, as PostgREST returns it. Order is not guaranteed. */
export type AlbumArtistRow = {
  position: number;
  artists: { id: string; mbid: string; name: string } | null;
};

/**
 * Credited artists in credit order.
 *
 * **Sorted here rather than in the query**, because a PostgREST embed makes no
 * ordering promise and the album page already sorts by `position` for the same
 * reason. A credit read out of order is a different credit.
 *
 * **A null `artists` row is dropped rather than rendered.** It means the join
 * came back mid-cascade, not that the album is credited to nothing — the
 * caller's fallback covers the genuinely uncredited case.
 */
export function toCreditedArtists(rows: AlbumArtistRow[] | null): CreditedArtist[] {
  return (rows ?? [])
    .filter((row): row is AlbumArtistRow & { artists: NonNullable<AlbumArtistRow['artists']> } =>
      Boolean(row.artists),
    )
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      id: row.artists.id,
      mbid: row.artists.mbid,
      name: row.artists.name,
      linkable: !isPseudoArtist(row.artists.mbid),
    }));
}

/**
 * Whether a credit is this artist and nobody else.
 *
 * **Compared by identity, not by name.** The previous rule compared the cached
 * `display_credit` string against the artist's current name, which meant a
 * renamed artist's own albums rendered a credit line *because the two strings
 * disagreed* — an accident that read as a feature. Identity makes the answer
 * deterministic: one credited artist, and it is this one.
 *
 * **What that costs is recorded rather than hidden.** An album released as
 * "Kanye West" by an artist MusicBrainz now calls "Ye" is correctly recognised
 * as theirs and suppressed on their own page, taking the as-released name with
 * it. `product-spec.md` §6 carries that decision and why it was accepted.
 */
export function creditIsSolely(artists: CreditedArtist[], artistMbid: string): boolean {
  return artists.length === 1 && artists[0].mbid.toLowerCase() === artistMbid.toLowerCase();
}
