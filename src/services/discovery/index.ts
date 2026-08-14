import { createClient } from '@/lib/supabase/server';

import type { AlbumSummary } from '../catalogue/queries';

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

/** Most popular albums we hold, by the active popularity signal. */
export async function getPopularAlbums(limit = 24): Promise<AlbumSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('albums')
    .select(COLUMNS)
    .not('popularity_score', 'is', null)
    .order('popularity_score', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toSummary);
}

/** Catalogue size, for orientation on the browse surface. */
export async function getCatalogueSize(): Promise<{ albums: number; artists: number }> {
  const supabase = await createClient();

  const [albums, artists] = await Promise.all([
    supabase.from('albums').select('id', { count: 'exact', head: true }),
    supabase.from('artists').select('id', { count: 'exact', head: true }),
  ]);

  if (albums.error) throw albums.error;
  if (artists.error) throw artists.error;

  return { albums: albums.count ?? 0, artists: artists.count ?? 0 };
}
