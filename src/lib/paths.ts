/**
 * Where a catalogue entity lives.
 *
 * **These exist because the URL shape changed once and will change again.**
 * Before this module, `/albums/${album.mbid}` was spelled inline in about a
 * dozen components and pages, so switching from identifiers to slugs meant
 * editing every one of them. The next change edits this file.
 *
 * **App layer rather than `src/services/`**, per the rule in `CLAUDE.md`: a
 * native client would need the *slug* to behave correctly, and does need it —
 * which is why the slug is catalogue data. It would have no use for a web path,
 * which is all these build.
 *
 * **They take the object, not the slug.** Passing `albumPath(album)` rather
 * than `albumPath(album.slug)` means a caller holding a summary that predates
 * the slug fails to compile, instead of silently building a path from whatever
 * string was nearest.
 */

/** Anything that knows its own slug. */
type Slugged = { slug: string };

/** An album's page. */
export function albumPath(album: Slugged): string {
  return `/albums/${album.slug}`;
}

/** An artist's page. `sort` is the discography ordering, omitted when default. */
export function artistPath(artist: Slugged, sort?: string): string {
  const base = `/artists/${artist.slug}`;
  return sort ? `${base}?sort=${sort}` : base;
}
