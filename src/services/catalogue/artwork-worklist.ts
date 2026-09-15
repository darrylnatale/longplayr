/**
 * Which albums a person could put a cover on, and where they would do it.
 *
 * **`architecture.md` §17b.** The queue view has shown `artwork_status` totals
 * since §17a, so the maintainer could see that covers were missing and **not
 * which albums**. The manual path was a search every time.
 *
 * **The pure half lives here so it can be tested.** The query and the rendering
 * both sit elsewhere; what is decided in this module is the deep link and what
 * a row says when it cannot have one.
 */

/**
 * Where a cover is uploaded, which is **a release page and not a release-group
 * one**.
 *
 * `artwork.ts` deals only in release-group MBIDs against Cover Art Archive, so
 * this is a different identifier from anything the artwork path already builds
 * — the target comes from `albums.representative_release_id`.
 */
const MUSICBRAINZ_ROOT = 'https://musicbrainz.org';

/** The add-cover-art page for a release. */
export function addCoverArtUrl(releaseMbid: string): string {
  return `${MUSICBRAINZ_ROOT}/release/${releaseMbid}/add-cover-art`;
}

/** One album on the worklist. */
export type UncoveredAlbum = {
  id: string;
  mbid: string;
  title: string;
  credit: string;
  /**
   * Null when the album has no representative release.
   *
   * **The row is still shown.** `representative_release_id` is nullable, and an
   * album without one has no page to link to — but dropping it would leave a
   * list that silently disagrees with the count beside it, which is §17's
   * failure class reproduced by the instrument meant to detect it.
   */
  addCoverArtUrl: string | null;
};

/** The album shape the query returns, with its representative release embedded. */
export type UncoveredAlbumRow = {
  id: string;
  mbid: string;
  title: string;
  display_credit: string;
  releases: { mbid: string } | null;
};

/** Shapes one queried row for display. */
export function toUncoveredAlbum(row: UncoveredAlbumRow): UncoveredAlbum {
  return {
    id: row.id,
    mbid: row.mbid,
    title: row.title,
    credit: row.display_credit,
    addCoverArtUrl: row.releases ? addCoverArtUrl(row.releases.mbid) : null,
  };
}

/**
 * The worklist, in two groups that ask different things of the reader.
 *
 * **`missingUpstream` is the actionable one** — Cover Art Archive genuinely
 * holds no image, so a person must upload it. **`fetchFailed` is deliberately
 * not presented as a task**: our own fetch broke and the artwork sweep re-queues
 * it on any drain, so listing it alongside the first group would ask the
 * maintainer to do work the system is still retrying.
 */
export type ArtworkWorklist = {
  missingUpstream: UncoveredAlbum[];
  fetchFailed: UncoveredAlbum[];
  /**
   * True totals, independent of how many rows were listed.
   *
   * **Taken from the same `countRows` totals the page already renders**, so the
   * two cannot disagree — and so a capped list never reports a confidently
   * wrong number, which is what §16.2's counting contract exists to prevent.
   */
  totals: { absent: number; failed: number };
  /** How many rows each group lists at most. */
  limit: number;
};

/**
 * How many rows to list per group.
 *
 * **A cap, because this is a diagnostic and not a catalogue.** Measured on the
 * deployed database on 2026-09-15, 161 albums had no cover; rendering every one
 * is slow and no more useful than rendering the first screenful. The total is
 * always printed alongside, so the cap never hides the size of the problem.
 */
export const WORKLIST_LIMIT = 50;

/** Whether a group is showing everything it counted. */
export function isTruncated(listed: number, total: number): boolean {
  return listed < total;
}
