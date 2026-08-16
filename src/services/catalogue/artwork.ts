import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Album artwork.
 *
 * Cover Art Archive is our only source. Both candidate fallbacks were rejected
 * on their terms (docs/architecture.md §7), so coverage gaps are permanent and
 * expected rather than a bug to chase.
 *
 * Two properties follow from that, and both matter:
 *
 *  - CAA is keyed by MBID, so a cover can never be attached to the wrong album.
 *    The rejected alternatives relied on fuzzy name matching, which produces
 *    exactly that.
 *  - `artwork_status` is recorded rather than inferred, so coverage is a number
 *    we can query. That is what makes revisiting this an evidence-based
 *    conversation instead of an argument.
 */

const CAA_ROOT = 'https://coverartarchive.org';

/** Sizes Cover Art Archive offers. 500 is our display size; 1200 is for detail. */
export const ARTWORK_SIZES = [250, 500, 1200] as const;
export type ArtworkSize = (typeof ARTWORK_SIZES)[number];

export const ARTWORK_BUCKET = 'artwork';

type Admin = SupabaseClient<Database>;

export type ArtworkResult =
  { status: 'found'; sizes: ArtworkSize[] } | { status: 'absent'; reason: string };

/** Cover Art Archive URL for a release group's front cover. */
export function coverArtUrl(albumMbid: string, size: ArtworkSize): string {
  return `${CAA_ROOT}/release-group/${albumMbid}/front-${size}`;
}

/** Storage path for a stored cover. */
export function artworkPath(albumMbid: string, size: ArtworkSize): string {
  return `${albumMbid}/${size}.jpg`;
}

/**
 * Public URL for a stored cover, or null when we have none.
 *
 * Callers render the placeholder on null. Deliberately synchronous and
 * side-effect free so it is cheap to call while rendering a grid of hundreds.
 */
export function storedArtworkUrl(
  supabaseUrl: string,
  albumMbid: string,
  size: ArtworkSize = 500,
): string {
  // Trailing whitespace and slashes are stripped deliberately. A tab pasted
  // into a Vercel environment variable survived `new URL()` — which tolerates
  // it — but not string concatenation, producing a malformed image URL that
  // the optimiser rejected with 400. Every cover on staging broke while the
  // pages themselves rendered fine, which made it look like an artwork bug.
  const base = supabaseUrl.trim().replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${ARTWORK_BUCKET}/${artworkPath(albumMbid, size)}`;
}

/**
 * Fetches one size from Cover Art Archive.
 *
 * A 404 means the community has not chosen a front cover — an ordinary outcome,
 * not an error. CAA imposes no rate limit, so artwork fetching does not compete
 * with MusicBrainz for the same budget.
 */
async function fetchCover(
  albumMbid: string,
  size: ArtworkSize,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const response = await fetch(coverArtUrl(albumMbid, size), {
    headers: { Accept: 'image/*' },
    redirect: 'follow', // CAA 307-redirects to archive.org
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Cover Art Archive returned ${response.status} for ${albumMbid} (${size})`);
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') ?? 'image/jpeg',
  };
}

/**
 * Resolves and stores artwork for one album, recording the outcome.
 *
 * Always updates `artwork_status`, including on absence — an album left
 * `pending` forever would be indistinguishable from one never attempted, and
 * coverage measurement depends on telling those apart.
 */
export async function fetchAndStoreArtwork(
  albumMbid: string,
  admin: Admin = createAdminClient(),
  sizes: readonly ArtworkSize[] = ARTWORK_SIZES,
): Promise<ArtworkResult> {
  const stored: ArtworkSize[] = [];

  for (const size of sizes) {
    const cover = await fetchCover(albumMbid, size);
    if (!cover) break; // No front cover at all; smaller sizes will not exist either.

    const { error } = await admin.storage
      .from(ARTWORK_BUCKET)
      .upload(artworkPath(albumMbid, size), cover.bytes, {
        contentType: cover.contentType,
        upsert: true,
      });

    if (error) throw error;
    stored.push(size);
  }

  const status = stored.length > 0 ? 'found' : 'absent';

  const { error } = await admin
    .from('albums')
    .update({ artwork_status: status, artwork_updated_at: new Date().toISOString() })
    .eq('mbid', albumMbid);

  if (error) throw error;

  return stored.length > 0
    ? { status: 'found', sizes: stored }
    : { status: 'absent', reason: 'no front cover in Cover Art Archive' };
}

/**
 * Coverage across the catalogue.
 *
 * The number that decides whether the single-source artwork decision needs
 * revisiting. Reported rather than guessed at.
 */
export async function artworkCoverage(admin: Admin = createAdminClient()): Promise<{
  found: number;
  absent: number;
  pending: number;
  total: number;
  coverage: number;
}> {
  const counts = await Promise.all(
    (['found', 'absent', 'pending'] as const).map(async (status) => {
      const { count, error } = await admin
        .from('albums')
        .select('id', { count: 'exact', head: true })
        .eq('artwork_status', status);
      if (error) throw error;
      return count ?? 0;
    }),
  );

  const [found, absent, pending] = counts;
  const total = found + absent + pending;
  const resolved = found + absent;

  return {
    found,
    absent,
    pending,
    total,
    // Share of *resolved* albums that have art. Pending ones are excluded
    // because they have not been attempted yet and would understate coverage.
    coverage: resolved === 0 ? 0 : Math.round((found / resolved) * 1000) / 10,
  };
}
