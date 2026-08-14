import type { PopularEntry, PopularitySource, PopularityRange } from './popularity';

/**
 * ListenBrainz popularity source.
 *
 * Chosen because it is MBID-native: the identifiers it returns are the same
 * ones MusicBrainz uses, so there is no name-matching step and therefore no
 * class of bug where a popularity score lands on the wrong album.
 *
 * Verified: `/1/stats/sitewide/release-groups` is public, needs no auth, and
 * accepts `count`, `offset` and `range`.
 *
 * **MBIDs are optional in responses.** Entries without one are dropped rather
 * than resolved by name — guessing is how wrong records enter a catalogue. The
 * usable result is therefore smaller than the raw count, which the seed report
 * makes visible rather than hiding.
 */

const API_ROOT = 'https://api.listenbrainz.org/1';

type ListenBrainzReleaseGroup = {
  release_group_mbid?: string | null;
  release_group_name?: string | null;
  artist_name?: string | null;
  artist_mbids?: string[] | null;
  /** Present when Cover Art Archive holds art for this release group. */
  caa_id?: number | null;
  listen_count?: number | null;
};

type ListenBrainzResponse = {
  payload?: {
    release_groups?: ListenBrainzReleaseGroup[];
    count?: number;
    total_release_group_count?: number;
    from_ts?: number;
    to_ts?: number;
    last_updated?: number;
  };
};

/** What the raw response contained, before and after filtering. */
export type FetchDiagnostics = {
  returned: number;
  missingMbid: number;
  usable: number;
};

export class ListenBrainzSource implements PopularitySource {
  readonly name = 'listenbrainz';

  /** Populated by the most recent call, for the seed report. */
  lastDiagnostics: FetchDiagnostics = { returned: 0, missingMbid: 0, usable: 0 };

  async topReleaseGroups({
    limit,
    range,
  }: {
    limit: number;
    range: PopularityRange;
  }): Promise<PopularEntry[]> {
    const url = new URL(`${API_ROOT}/stats/sitewide/release-groups`);
    url.searchParams.set('count', String(Math.min(limit, 1000)));
    url.searchParams.set('range', range === 'all_time' ? 'all_time' : range);

    const response = await fetch(url, { headers: { Accept: 'application/json' } });

    if (!response.ok) {
      throw new Error(`ListenBrainz returned ${response.status} for ${url.pathname}`);
    }

    const body = (await response.json()) as ListenBrainzResponse;
    const rows = body.payload?.release_groups ?? [];

    const usable: PopularEntry[] = [];
    let missingMbid = 0;

    rows.forEach((row, index) => {
      if (!row.release_group_mbid) {
        missingMbid += 1;
        return;
      }
      usable.push({
        mbid: row.release_group_mbid,
        title: row.release_group_name ?? '(untitled)',
        artistName: row.artist_name ?? '(unknown)',
        artistMbid: row.artist_mbids?.[0] ?? null,
        hasArtwork: Boolean(row.caa_id),
        // Rank position is a more stable ordinal than raw listen counts, which
        // vary hugely in magnitude between ranges.
        score: rows.length - index,
      });
    });

    this.lastDiagnostics = { returned: rows.length, missingMbid, usable: usable.length };
    return usable;
  }
}
