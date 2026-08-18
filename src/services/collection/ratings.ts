import { createClient } from '@/lib/supabase/server';

/**
 * Album averages, computed at read time.
 *
 * **No stored aggregate**, by decision D4, and the consequence is worth stating
 * because it is the reason the decision is right: deletion needs no
 * recomputation step. When an account is hard-deleted the aggregate simply
 * stops including those rows. A stored counter would need a careful decrement
 * across potentially thousands of albums, every one an opportunity for
 * permanent drift that nothing would ever detect.
 *
 * Unrated entries are excluded from averages. **`0.0` is a score and counts**;
 * only `null` is unrated. Conflating the two is the obvious bug here, so the
 * exclusion is expressed as `not null` rather than as a truthiness test.
 */

export type RatingSummary = {
  /** Mean of non-null ratings, to one decimal. Null when nothing is rated. */
  average: number | null;
  /** How many entries carry a rating. Excludes unrated entries. */
  count: number;
};

/**
 * Rounds to one decimal place.
 *
 * `Math.round(x * 10) / 10` alone misrounds certain binary fractions — the
 * classic case being values that land a hair below .05 after multiplication.
 * Nudging by `Number.EPSILON` scaled to the magnitude keeps 8.25 → 8.3 rather
 * than 8.2, which is what a person reading the number expects.
 */
export function toOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON * Math.abs(value)) * 10) / 10;
}

/** Average and count for one album. */
export async function getAlbumRating(albumId: string): Promise<RatingSummary> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('collection_entries')
    .select('rating')
    .eq('album_id', albumId)
    .not('rating', 'is', null);

  if (error) throw error;

  const ratings = (data ?? [])
    .map((row) => row.rating)
    .filter((r): r is number => r !== null)
    .map(Number);

  if (ratings.length === 0) return { average: null, count: 0 };

  const mean = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  return { average: toOneDecimal(mean), count: ratings.length };
}

/**
 * How many people hold an album.
 *
 * Distinct from the rating count: an album can be widely collected and barely
 * rated, and showing one number for both would misrepresent thin data.
 */
export async function getAlbumCollectorCount(albumId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('collection_entries')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', albumId);

  if (error) throw error;
  return count ?? 0;
}
