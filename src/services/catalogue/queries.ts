import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { toCreditedArtists } from './credit';
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

/** Recently added albums. A placeholder browse surface until discovery lands. */
export async function getRecentAlbums(limit = 24): Promise<AlbumSummaryWithArtists[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('albums')
    .select(ALBUM_SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toSummary);
}
