import { createClient } from '@/lib/supabase/server';
import { countRows, COUNT_ONLY } from '@/services/count';
import type { Database } from '@/lib/supabase/database.types';

import { toCreditedArtists } from './credit';
import { catalogueOrderFor, DEFAULT_CATALOGUE_SORT } from './catalogue-sort';
import { recentReadDepth, selectRecent } from './recent-selection';

import type { CatalogueSort } from './catalogue-sort';

import type { RecentSelectionOptions } from './recent-selection';
import { formatPartialDate } from './scope';

import type { AlbumArtistRow, CreditedArtist } from './credit';

/**
 * Catalogue reads.
 *
 * Note the embed syntax: `releases!releases_album_id_fkey(...)`. There are two
 * relationships between albums and releases — `releases.album_id` and
 * `albums.representative_release_id` — so a bare `releases(...)` embed is
 * ambiguous and PostgREST refuses it outright.
 */

type Album = Database['public']['Tables']['albums']['Row'];
type Artist = Database['public']['Tables']['artists']['Row'];

export type AlbumDetail = Album & {
  artists: Pick<Artist, 'id' | 'mbid' | 'name'>[];
  tracks: { position: number; medium_position: number; title: string; length_ms: number | null }[];
  editionCount: number;
  releaseDateLabel: string | null;
  /**
   * The MBID of the release chosen at ingest, or null when there is none.
   *
   * **Exposed because cover art is uploaded against a release**, not a
   * release-group — a different identifier from the one `artwork.ts` fetches
   * on. `representative_release_id` is a local id; this is the upstream one the
   * album page needs to send a reader to the right page
   * (`product-spec.md` §8.9).
   *
   * **Derived rather than fetched.** The editions embed already carries every
   * release with its MBID, so this costs a lookup and no extra query.
   */
  representativeReleaseMbid: string | null;
};

export type ArtistDetail = Artist & {
  albums: AlbumSummaryWithArtists[];
};

export type AlbumSummary = Pick<
  Album,
  'id' | 'mbid' | 'title' | 'display_credit' | 'primary_type' | 'artwork_status'
> & {
  first_release_date: string | null;
  first_release_date_precision: Database['public']['Enums']['date_precision'] | null;
  releaseYear: string | null;
};

/**
 * An `AlbumSummary` that can render a linked credit.
 *
 * **A separate type rather than a widening, and that is the whole point.**
 * `AlbumSummary` is consumed by surfaces that print no credit at all — the
 * collection grid carries none by `design-reference.md` §11.9, and Browse's
 * *Popular* section passes no captions — so adding the embed to the base type
 * would make every consumer pay a join for a value most never render, on the
 * busiest reads in the product. `architecture.md` §16.7.
 *
 * **`AlbumGrid` requires this type whenever captions are on**, so a future
 * captioned surface fails to compile rather than silently rendering a credit
 * nobody can click.
 */
export type AlbumSummaryWithArtists = AlbumSummary & { artists: CreditedArtist[] };

const ALBUM_SUMMARY_COLUMNS =
  'id, mbid, title, display_credit, primary_type, artwork_status, first_release_date, first_release_date_precision, album_artists(position, artists(id, mbid, name))';

function toSummary(row: {
  id: string;
  mbid: string;
  title: string;
  display_credit: string;
  primary_type: Database['public']['Enums']['album_type'];
  artwork_status: Database['public']['Enums']['artwork_status'];
  first_release_date: string | null;
  first_release_date_precision: Database['public']['Enums']['date_precision'] | null;
  album_artists: AlbumArtistRow[] | null;
}): AlbumSummaryWithArtists {
  const { album_artists, ...album } = row;

  return {
    ...album,
    releaseYear: row.first_release_date?.slice(0, 4) ?? null,
    artists: toCreditedArtists(album_artists),
  };
}

/** Full album detail, or null when we do not hold it. */
export async function getAlbumByMbid(mbid: string): Promise<AlbumDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('albums')
    .select(
      `*,
       album_artists(position, artists(id, mbid, name)),
       releases!releases_album_id_fkey(id, mbid)`,
    )
    .eq('mbid', mbid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // The tracklist comes from the representative release, chosen deterministically
  // at ingest (docs/data-model.md §2).
  let tracks: AlbumDetail['tracks'] = [];
  if (data.representative_release_id) {
    const { data: trackRows, error: trackError } = await supabase
      .from('tracks')
      .select('position, medium_position, title, length_ms')
      .eq('release_id', data.representative_release_id)
      .order('medium_position')
      .order('position');
    if (trackError) throw trackError;
    tracks = trackRows ?? [];
  }

  const artists = (data.album_artists ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((credit) => credit.artists)
    .filter((artist): artist is NonNullable<typeof artist> => artist !== null);

  return {
    ...data,
    artists,
    tracks,
    editionCount: data.releases?.length ?? 0,
    representativeReleaseMbid:
      (data.releases ?? []).find((release) => release.id === data.representative_release_id)
        ?.mbid ?? null,
    releaseDateLabel: formatPartialDate(data.first_release_date, data.first_release_date_precision),
  };
}

/**
 * Which end of the discography leads.
 *
 * Release date only. Sorting by rating, and any artist-level aggregate, are
 * **deferred** — `product-spec.md` §6 carried them as `[INFERRED]` on the
 * premise that they would reuse the collection view's sort machinery, which
 * does not exist. Resolved 2026-08-20 in favour of date alone.
 */
export type DiscographySort = 'newest' | 'oldest';

/**
 * The discography comparator, exported and pure so it can be tested.
 *
 * Same reason as the collection and favourites mappers: `getArtistByMbid`
 * builds a cookie-bound client and cannot be called without a request scope, so
 * the integration suite proves the query and this proves the ordering.
 *
 * **Undated releases sort last in both directions.** Reversing the comparator
 * wholesale would float them to the top of an oldest-first list, which is not
 * "oldest" — it is "unknown", and it would jumble the run the interleaved
 * chronology exists to keep readable (`product-spec.md` §6).
 */
export function byReleaseDate(sort: DiscographySort) {
  return (a: { first_release_date: string | null }, b: { first_release_date: string | null }) => {
    if (!a.first_release_date) return 1;
    if (!b.first_release_date) return -1;

    return sort === 'oldest'
      ? a.first_release_date.localeCompare(b.first_release_date)
      : b.first_release_date.localeCompare(a.first_release_date);
  };
}

/**
 * An artist with their full discography.
 *
 * **Newest first unless asked otherwise.** The run is ordered by release date
 * in one of the two supported directions, albums, EPs and mixtapes interleaved
 * and never grouped by type (`product-spec.md` §6), with undated releases last
 * either way.
 */
export async function getArtistByMbid(
  mbid: string,
  sort: DiscographySort = 'newest',
): Promise<ArtistDetail | null> {
  const supabase = await createClient();

  const { data: artist, error } = await supabase
    .from('artists')
    .select('*')
    .eq('mbid', mbid)
    .maybeSingle();

  if (error) throw error;
  if (!artist) return null;

  // One interleaved chronological run, newest first — albums, EPs and mixtapes
  // together, never grouped by type (docs/product-spec.md §6).
  const { data: credits, error: creditsError } = await supabase
    .from('album_artists')
    .select(`albums(${ALBUM_SUMMARY_COLUMNS})`)
    .eq('artist_id', artist.id);

  if (creditsError) throw creditsError;

  const albums = (credits ?? [])
    .map((row) => row.albums)
    .filter((album): album is NonNullable<typeof album> => album !== null)
    .map(toSummary)
    .sort(byReleaseDate(sort));

  return { ...artist, albums };
}

/** PostgREST answers an offset past the end with an error, not an empty window. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/** One bounded window onto the catalogue, plus the size of the whole thing. */
export type CataloguePage = {
  albums: AlbumSummaryWithArtists[];
  /** Every album held, not the length of this page. */
  total: number;
};

/** How many albums one page of the catalogue-wide surface holds. */
export const CATALOGUE_PAGE_SIZE = 60;

/**
 * Every album in the catalogue, one page at a time.
 *
 * **The surface that must include what every other one excludes.** Browse's
 * Popular section reads `popularity_score` and drops rows where it is null —
 * which is every self-service addition. `product-spec.md` §8.9 holds that
 * **absence of an external signal must never gate discovery**, and this is the
 * first query where that stops being a principle and becomes a `where` clause
 * that is deliberately absent. **There is no filter here at all**, and that is
 * the point rather than an omission.
 *
 * **No popularity sort either** (§8.3): an external score completes a chart and
 * never orders a surface.
 */
export async function getCatalogueAlbums({
  sort = DEFAULT_CATALOGUE_SORT,
  reversed = false,
  limit = CATALOGUE_PAGE_SIZE,
  offset = 0,
}: {
  sort?: CatalogueSort;
  reversed?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<CataloguePage> {
  const supabase = await createClient();

  let query = supabase.from('albums').select(ALBUM_SUMMARY_COLUMNS, { count: 'exact' });

  // Applied in sequence, ending at `created_at` so the ordering is total —
  // without that, two rows comparing equal can swap between requests and an
  // album can appear twice, or not at all, across a page boundary.
  for (const clause of catalogueOrderFor(sort, reversed)) {
    query = query.order(clause.column, {
      ascending: clause.ascending,
      nullsFirst: clause.nullsFirst,
    });
  }

  const { data, count, error } = await query.range(offset, offset + limit - 1);

  // **An offset past the end is a fact about the request, not a fault.** The
  // destination has to be able to ask for page 99 of a catalogue that has two
  // and be told so — and PostgREST answers that with `PGRST103` rather than an
  // empty window. The count does not come back on that response, so this is the
  // one case that costs a second round trip.
  //
  // The same shape `listRelationship` already uses; the constant is restated
  // here rather than imported because a catalogue read has no business
  // depending on the social service.
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const total = await countRows(
      supabase.from('albums').select('id', COUNT_ONLY),
      'albums.catalogue_total',
    );

    return { albums: [], total };
  }

  if (error) throw error;

  return { albums: (data ?? []).map(toSummary), total: count ?? 0 };
}

/** Recently added albums. A placeholder browse surface until discovery lands. */
export async function getRecentAlbums(
  limit = 24,
  options: RecentSelectionOptions = {},
): Promise<AlbumSummaryWithArtists[]> {
  const supabase = await createClient();

  // **Reads deeper than it renders**, because both selection rules remove rows
  // *after* the read — so reading exactly `limit` guarantees an under-filled
  // grid the moment either one does anything (`recent-selection.ts`).
  const { data, error } = await supabase
    .from('albums')
    .select(ALBUM_SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(recentReadDepth(limit));

  if (error) throw error;

  // The narrowing is a pure function so it can be proven directly. **Order is
  // established here and never re-established there** — deduplication keeps the
  // first album it sees for an artist, which is their most recent only because
  // of the `order by` above.
  return selectRecent((data ?? []).map(toSummary), limit, options);
}
