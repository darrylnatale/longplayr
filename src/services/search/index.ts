import { createClient } from '@/lib/supabase/server';

import { toCreditedArtists } from '../catalogue/credit';

import type { AlbumArtistRow, CreditedArtist } from '../catalogue/credit';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Search.
 *
 * Ranking is tiered in the database (`search_albums`, `search_artists`): text
 * relevance selects the tier, popularity only orders within it. See the
 * migration for why that is preferred over a weighted score.
 *
 * The hard problem here is disambiguation, not matching. Many albums share a
 * title, and deciding which "Blonde" someone meant is what the popularity
 * tiebreak exists for.
 */

export type AlbumHit = {
  id: string;
  mbid: string;
  title: string;
  display_credit: string;
  primary_type: Database['public']['Enums']['album_type'];
  artwork_status: Database['public']['Enums']['artwork_status'];
  first_release_date: string | null;
  first_release_date_precision: Database['public']['Enums']['date_precision'] | null;
  popularity_score: number | null;
  releaseYear: string | null;
  tier: number;
  /**
   * Who the result is credited to, as links (`product-spec.md` §6).
   *
   * **Search is the one surface that cannot get this from an embed.** It reads
   * the `search_albums` RPC, whose columns are fixed by a SQL signature, so the
   * function aggregates the artists itself — returning the **same shape** the
   * PostgREST embed returns, which is why `toCreditedArtists` serves both
   * unchanged. `architecture.md` §16.8.
   */
  artists: CreditedArtist[];
};

export type ArtistHit = {
  id: string;
  mbid: string;
  name: string;
  disambiguation: string | null;
  album_count: number;
};

export type UserHit = { handle: string; display_name: string | null };

export type SearchResults = {
  query: string;
  albums: AlbumHit[];
  artists: ArtistHit[];
  users: UserHit[];
};

/** Guards against pathological input before it reaches the database. */
export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 100);
}

export async function searchCatalogue(
  rawQuery: string,
  options: { albumLimit?: number; artistLimit?: number; userLimit?: number } = {},
): Promise<SearchResults> {
  const query = normaliseQuery(rawQuery);

  if (query === '') {
    return { query, albums: [], artists: [], users: [] };
  }

  const supabase = await createClient();

  const [albums, artists, users] = await Promise.all([
    supabase.rpc('search_albums', { query, max_results: options.albumLimit ?? 20 }),
    supabase.rpc('search_artists', { query, max_results: options.artistLimit ?? 8 }),
    supabase
      .from('profiles')
      .select('handle, display_name')
      .eq('status', 'active')
      .ilike('handle', `${query.toLowerCase()}%`)
      .limit(options.userLimit ?? 5),
  ]);

  if (albums.error) throw albums.error;
  if (artists.error) throw artists.error;
  if (users.error) throw users.error;

  return {
    query,
    albums: (albums.data ?? []).map((row) => {
      const { artists: credited, ...album } = row;

      return {
        ...album,
        releaseYear: row.first_release_date?.slice(0, 4) ?? null,
        /*
         * **A narrow cast, because `jsonb` generates as `Json`.** The database
         * types cannot express the aggregate's shape, and the migration is the
         * only producer of this column. `toCreditedArtists` drops malformed
         * rows rather than trusting the cast, so a shape change surfaces as a
         * missing credit rather than as a crash.
         */
        artists: toCreditedArtists(credited as unknown as AlbumArtistRow[]),
      };
    }),
    artists: artists.data ?? [],
    users: users.data ?? [],
  };
}
