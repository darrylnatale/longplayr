import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

import { countRows, COUNT_ONLY } from '../count';
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

/** Cover Art Archive could not be reached, or errored. Retryable — not absence. */
export class CoverArtUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoverArtUnavailableError';
  }
}

/**
 * Sizes we fetch and store. **Only the ones something actually serves.**
 *
 * `250` is the dominant size — the grid at `standard` and `dense`, collection
 * tiles, feed items, search results and the list page. `500` serves the album
 * page, favourites and the grid at `relaxed`. **`1200` served nothing**: the
 * comment this replaces said it was "for detail", but the album page, the one
 * surface where a detail size would live, asks for 500 explicitly.
 *
 * Each size costs a Cover Art Archive fetch — which `307`-redirects to
 * archive.org, so two round trips — plus a separate upload, and the loop below
 * is sequential. Three sizes was about ten seconds a job against the cron's
 * 45-second budget, or four covers a night while 22.6% of the catalogue had
 * none. Two is about seven.
 *
 * **Dropping a size defers it rather than forecloses it.** Artwork is
 * re-fetchable from Cover Art Archive whenever we want it: the catalogue is
 * read-only downstream, CAA is canonical and imposes no rate limit, and
 * `enqueueMissingArtwork` already sweeps everything. Wiring up a detail size
 * later costs one sweep.
 *
 * `ArtworkSize` derives from this array, so asking for a size we do not store
 * is a compile error rather than a 404. `architecture.md` §7, *Store only the
 * sizes that are served*.
 */
export const ARTWORK_SIZES = [250, 500] as const;
export type ArtworkSize = (typeof ARTWORK_SIZES)[number];

export const ARTWORK_BUCKET = 'artwork';

type Admin = SupabaseClient<Database>;

/**
 * Outcome of one artwork attempt.
 *
 * `absent` and `failed` are deliberately distinct. Absent is a fact about the
 * artwork — Cover Art Archive answered and holds no front cover. Failed is a
 * fact about the network. Conflating them is what let a catalogue missing 36
 * covers report 100% coverage.
 */
export type ArtworkResult =
  | { status: 'found'; sizes: ArtworkSize[] }
  | { status: 'absent'; reason: string }
  | { status: 'failed'; reason: string };

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

  // 404 is an answer: this release group has no front cover. Anything else is
  // a failure to get an answer, which is a different thing entirely.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new CoverArtUnavailableError(
      `Cover Art Archive returned ${response.status} for ${albumMbid} (${size})`,
    );
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
  let result: ArtworkResult;

  try {
    for (const size of sizes) {
      const cover = await fetchCover(albumMbid, size);
      // A 404 on the first size means no front cover exists; the others will
      // not either.
      if (!cover) break;

      const { error } = await admin.storage
        .from(ARTWORK_BUCKET)
        .upload(artworkPath(albumMbid, size), cover.bytes, {
          contentType: cover.contentType,
          upsert: true,
        });

      if (error) throw error;
      stored.push(size);
    }

    result =
      stored.length > 0
        ? { status: 'found', sizes: stored }
        : { status: 'absent', reason: 'Cover Art Archive holds no front cover' };
  } catch (error) {
    // Recorded rather than thrown. Previously this propagated, the album stayed
    // 'pending', and coverage counted it as "not attempted" — which is how a
    // catalogue with 36 coverless albums reported 100% coverage.
    result = {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const { error } = await admin
    .from('albums')
    .update({ artwork_status: result.status, artwork_updated_at: new Date().toISOString() })
    .eq('mbid', albumMbid);

  if (error) throw error;

  return result;
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
  failed: number;
  pending: number;
  total: number;
  /** found / (found + absent + failed). Failures are never hidden. */
  observedCoveragePercent: number;
}> {
  const counts = await Promise.all(
    (['found', 'absent', 'failed', 'pending'] as const).map((status) =>
      countRows(
        admin.from('albums').select('id', COUNT_ONLY).eq('artwork_status', status),
        'albums.by_artwork_status',
      ),
    ),
  );

  const [found, absent, failed, pending] = counts;
  const total = found + absent + failed + pending;

  // Everything attempted, including failures. Excluding failures is what
  // produced a "100% coverage" report for a catalogue missing 36 covers.
  const attempted = found + absent + failed;

  return {
    found,
    absent,
    failed,
    pending,
    total,
    observedCoveragePercent: attempted === 0 ? 0 : Math.round((found / attempted) * 1000) / 10,
  };
}
