/**
 * Representative release selection.
 *
 * MusicBrainz attaches tracklists to releases, not release groups, so an album
 * page must nominate one release to source its tracklist from.
 *
 * "Earliest official release" is the rule, but it is underdetermined far more
 * often than it sounds: bootlegs and promos predate official pressings, many
 * releases carry year-only dates or none at all, and some release groups have
 * no Official release whatsoever. The tail of this comparator exists so that
 * re-ingesting the same album always picks the same release — otherwise a
 * tracklist could silently change on every sync.
 *
 * Rule (docs/data-model.md §2):
 *   1. Earliest Official release, by date
 *   2. Failing that, earliest release of any status
 *   3. Break ties on completeness: known date, then track count, then country
 *   4. Break remaining ties on MBID, purely for determinism
 */

export type ReleaseCandidate = {
  mbid: string;
  status?: string | null;
  /** Normalised to a full date; null when the source gave none. */
  date?: string | null;
  country?: string | null;
  trackCount?: number | null;
};

function compare(a: ReleaseCandidate, b: ReleaseCandidate): number {
  // Dated releases sort ahead of undated ones.
  const aHasDate = Boolean(a.date);
  const bHasDate = Boolean(b.date);
  if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;

  if (a.date && b.date && a.date !== b.date) {
    return a.date < b.date ? -1 : 1;
  }

  // Completeness, as a proxy for "better catalogued".
  const aHasTracks = (a.trackCount ?? 0) > 0;
  const bHasTracks = (b.trackCount ?? 0) > 0;
  if (aHasTracks !== bHasTracks) return aHasTracks ? -1 : 1;

  const aHasCountry = Boolean(a.country);
  const bHasCountry = Boolean(b.country);
  if (aHasCountry !== bHasCountry) return aHasCountry ? -1 : 1;

  // Deterministic tiebreak. Without this, ordering depends on whatever order
  // MusicBrainz happened to return, and the tracklist can change on re-sync.
  return a.mbid < b.mbid ? -1 : a.mbid > b.mbid ? 1 : 0;
}

export function selectRepresentativeRelease<T extends ReleaseCandidate>(
  releases: readonly T[],
): T | null {
  if (releases.length === 0) return null;

  const official = releases.filter((release) => release.status?.toLowerCase() === 'official');
  const candidates = official.length > 0 ? official : releases;

  return [...candidates].sort(compare)[0] ?? null;
}
