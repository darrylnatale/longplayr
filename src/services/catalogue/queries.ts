import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { formatPartialDate } from './scope';

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
  albums: AlbumSummary[];
};

export type AlbumSummary = Pick<
  Album,
  'id' | 'mbid' | 'title' | 'display_credit' | 'primary_type' | 'artwork_status'
> & {
  first_release_date: string | null;
  first_release_date_precision: Database['public']['Enums']['date_precision'] | null;
  releaseYear: string | null;
};

const ALBUM_SUMMARY_COLUMNS =
  'id, mbid, title, display_credit, primary_type, artwork_status, first_release_date, first_release_date_precision';

function toSummary(row: {
  id: string;
  mbid: string;
  title: string;
  display_credit: string;
  primary_type: Database['public']['Enums']['album_type'];
  artwork_status: Database['public']['Enums']['artwork_status'];
  first_release_date: string | null;
  first_release_date_precision: Database['public']['Enums']['date_precision'] | null;
}): AlbumSummary {
  return {
    ...row,
    releaseYear: row.first_release_date?.slice(0, 4) ?? null,
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

/** An artist with their full discography, newest first. */
export async function getArtistByMbid(mbid: string): Promise<ArtistDetail | null> {
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
    .sort((a, b) => {
      // Undated releases sort last rather than jumbling into the run.
      if (!a.first_release_date) return 1;
      if (!b.first_release_date) return -1;
      return b.first_release_date.localeCompare(a.first_release_date);
    });

  return { ...artist, albums };
}

/** Recently added albums. A placeholder browse surface until discovery lands. */
export async function getRecentAlbums(limit = 24): Promise<AlbumSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('albums')
    .select(ALBUM_SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toSummary);
}
