import { createClient } from '@/lib/supabase/server';

import type { AlbumSummary } from '../catalogue/queries';
import { countRows, COUNT_ONLY } from '../count';

import { combinePopular, externalShortfall, internalReadDepth } from './chart';

/**
 * Discovery.
 *
 * Phase 1 provides a browse surface only. The real charts — popular this week
 * and highest rated this week, defined in docs/product-spec.md §8.3 — need
 * collection and rating activity that does not exist until Phase 2, so
 * computing them now would produce empty tables.
 *
 * Until then this ranks by the external popularity signal, which is exactly
 * the cold-start fallback the charts will use anyway when internal activity is
 * thin.
 */

const COLUMNS =
  'id, mbid, title, display_credit, primary_type, artwork_status, first_release_date, first_release_date_precision, popularity_score';

function toSummary(row: {
  id: string;
  mbid: string;
  title: string;
  display_credit: string;
  primary_type: AlbumSummary['primary_type'];
  artwork_status: AlbumSummary['artwork_status'];
  first_release_date: string | null;
  first_release_date_precision: AlbumSummary['first_release_date_precision'];
}): AlbumSummary {
  return { ...row, releaseYear: row.first_release_date?.slice(0, 4) ?? null };
}

/**
 * "Popular this week" — `product-spec.md` §8.3.
 *
 * **Two reads, and they are two different signals.** The first is longplayr's
 * own chart, materialised from collection and relisten activity by
 * `refresh_popular_this_week()`. The second is the external cold-start fallback,
 * which completes the chart to §8.3's floor of 20 when internal activity yields
 * fewer — **and adds nothing at all when it yields 20 or more.**
 *
 * **The caller's `limit` is a rendering cap, never the fill target.** Browse
 * passes 24 and that number has no product standing; the floor is 20 and lives
 * in `chart.ts`. Keeping them apart is the whole point of that module.
 *
 * **The external half reads `albums.popularity_score` rather than calling
 * `PopularitySource`.** `topReleaseGroups` is a live ListenBrainz request
 * returning MBIDs we may not even hold; making it during a page render would put
 * network latency and rate-limit exposure on Browse. `architecture.md` §8 settles
 * the contract — callers read the column, sources write it. **Reading it here is
 * not repurposing it as the internal signal, and nothing below writes it.**
 *
 * **The internal half applies no `popularity_score` filter**, which is what lets
 * an album no external source has heard of appear on Browse at all. §8.9 records
 * that null must never gate discovery. The external *fill* still cannot offer a
 * null-score album, and that half stays unresolved: there, null means the source
 * genuinely has nothing to say.
 *
 * An empty chart is not an error. Nothing internal qualifies, the fallback
 * supplies everything, and the result is the pre-slice behaviour exactly.
 */
export async function getPopularAlbums(limit = 24): Promise<AlbumSummary[]> {
  const supabase = await createClient();

  // Read at least the floor, whatever the caller asked for — see
  // `internalReadDepth`. A short read is then proof the chart is short.
  const { data: chartRows, error: chartError } = await supabase
    .from('discovery_chart_entries')
    .select(`albums (${COLUMNS})`)
    .eq('chart', 'popular_this_week')
    .order('rank', { ascending: true })
    .limit(internalReadDepth(limit));

  if (chartError) throw chartError;

  const internal = (chartRows ?? [])
    .map((row) => row.albums)
    .filter((album): album is NonNullable<typeof album> => album !== null)
    .map(toSummary);

  const shortfall = externalShortfall(internal.length);
  let external: AlbumSummary[] = [];

  if (shortfall > 0) {
    let query = supabase
      .from('albums')
      .select(COLUMNS)
      .not('popularity_score', 'is', null)
      .order('popularity_score', { ascending: false })
      .limit(shortfall);

    // **Guarded, because PostgREST rejects an empty `in.()`.** With no internal
    // results there is nothing to exclude, and building the filter anyway would
    // turn the commonest case — an empty chart — into a syntax error.
    if (internal.length > 0) {
      query = query.not('id', 'in', `(${internal.map((album) => album.id).join(',')})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    external = (data ?? []).map(toSummary);
  }

  return combinePopular({ internal, external, limit });
}

/** Catalogue size, for orientation on the browse surface. */
export async function getCatalogueSize(): Promise<{ albums: number; artists: number }> {
  const supabase = await createClient();

  const [albums, artists] = await Promise.all([
    countRows(supabase.from('albums').select('id', COUNT_ONLY), 'albums.catalogue_size'),
    countRows(supabase.from('artists').select('id', COUNT_ONLY), 'artists.catalogue_size'),
  ]);

  return { albums, artists };
}
