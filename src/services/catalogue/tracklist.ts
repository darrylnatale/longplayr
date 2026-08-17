import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

import { mapReleaseDetail, type MappedRelease } from './map';
import { getRelease, NotFoundError } from './musicbrainz';

/**
 * Release tracklists.
 *
 * Tracklists cost a second MusicBrainz request per album, because release-group
 * responses carry no `media` and no `track-count`. That second request can fail
 * independently of the first, and for a long time it did so invisibly: the
 * album was written, the failure was swallowed, and nothing recorded that a
 * tracklist had even been attempted.
 *
 * The rule here is the same one artwork already follows. A fetch that fails is
 * never recorded as an answer. `absent` means MusicBrainz replied and the
 * release carries no tracks; `failed` means we did not get a reply. Only the
 * second is worth retrying, and it must always be retryable.
 */

type Admin = SupabaseClient<Database>;

/** The tracklist could not be fetched. Retryable — not absence. */
export class TracklistUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TracklistUnavailableError';
  }
}

/** Outcome of one tracklist attempt. */
export type TracklistResult =
  | { status: 'found'; trackCount: number }
  | { status: 'absent'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Writes the tracklist for one release, replacing whatever was there.
 *
 * Wholesale replacement rather than diffing: tracklists are small, and upstream
 * corrections routinely renumber or retitle tracks, which a diff would handle
 * worse than a rewrite.
 */
export async function replaceTracks(
  admin: Admin,
  releaseId: string,
  detail: MappedRelease,
): Promise<void> {
  const { error: deleteError } = await admin.from('tracks').delete().eq('release_id', releaseId);
  if (deleteError) throw deleteError;

  if (detail.tracks.length > 0) {
    const { error } = await admin
      .from('tracks')
      .insert(detail.tracks.map((track) => ({ ...track, release_id: releaseId })));
    if (error) throw error;
  }

  // Format, label and track count are only known from the detail response.
  const { error: updateError } = await admin
    .from('releases')
    .update({
      format: detail.release.format,
      label: detail.release.label,
      track_count: detail.release.track_count,
    })
    .eq('id', releaseId);
  if (updateError) throw updateError;
}

/** Records the outcome against the release row. Always called, including on failure. */
export async function recordTracklistStatus(
  admin: Admin,
  releaseId: string,
  status: TracklistResult['status'],
): Promise<void> {
  const { error } = await admin
    .from('releases')
    .update({ tracklist_status: status, tracklist_updated_at: new Date().toISOString() })
    .eq('id', releaseId);
  if (error) throw error;
}

/**
 * Turns a fetched release detail into an outcome and writes it.
 *
 * A release that genuinely carries no tracks is `absent` — MusicBrainz answered
 * and the answer was nothing. That is not the same as never having asked.
 */
export async function storeTracklist(
  admin: Admin,
  releaseId: string,
  detail: MappedRelease,
): Promise<TracklistResult> {
  await replaceTracks(admin, releaseId, detail);

  const result: TracklistResult =
    detail.tracks.length > 0
      ? { status: 'found', trackCount: detail.tracks.length }
      : { status: 'absent', reason: 'MusicBrainz holds no tracks for this release' };

  await recordTracklistStatus(admin, releaseId, result.status);
  return result;
}

/**
 * Fetches and stores one release's tracklist, recording the outcome.
 *
 * Records rather than throws, so a caller mid-ingest can carry on with an album
 * that is otherwise fine. Callers that own retrying — the job runner — inspect
 * the returned status and re-raise.
 */
export async function fetchAndStoreTracklist(
  releaseMbid: string,
  admin: Admin = createAdminClient(),
): Promise<TracklistResult> {
  const { data: release, error } = await admin
    .from('releases')
    .select('id')
    .eq('mbid', releaseMbid)
    .maybeSingle();
  if (error) throw error;

  // Nothing to attach a tracklist to. Not retryable, and not this job's problem.
  if (!release) {
    return { status: 'failed', reason: `No release row for ${releaseMbid}` };
  }

  try {
    const detail = mapReleaseDetail(await getRelease(releaseMbid));
    return await storeTracklist(admin, release.id, detail);
  } catch (cause) {
    // A 404 is an answer: MusicBrainz no longer resolves this release, most
    // likely a merge. Retrying cannot change that, so it is recorded as absence
    // rather than left to burn attempts.
    if (cause instanceof NotFoundError) {
      const result: TracklistResult = {
        status: 'absent',
        reason: `MusicBrainz no longer resolves release ${releaseMbid}`,
      };
      await recordTracklistStatus(admin, release.id, result.status);
      return result;
    }

    const result: TracklistResult = {
      status: 'failed',
      reason: cause instanceof Error ? cause.message : String(cause),
    };
    await recordTracklistStatus(admin, release.id, result.status);
    return result;
  }
}

/**
 * Tracklist coverage across the catalogue.
 *
 * Counted over representative releases only. Every other release is `pending`
 * by design — we never fetch tracklists for editions nobody has opened — and
 * including them would drown the number that matters in six thousand rows that
 * were never meant to have one.
 */
export async function tracklistCoverage(admin: Admin = createAdminClient()): Promise<{
  found: number;
  absent: number;
  failed: number;
  pending: number;
  total: number;
  /** found / (found + absent + failed). Failures are never hidden. */
  observedCoveragePercent: number;
}> {
  const { data, error } = await admin
    .from('albums')
    .select('releases!albums_representative_release_fk(tracklist_status)')
    .not('representative_release_id', 'is', null);
  if (error) throw error;

  const counts = { found: 0, absent: 0, failed: 0, pending: 0 };
  for (const row of data ?? []) {
    const release = row.releases as { tracklist_status: keyof typeof counts } | null;
    if (release) counts[release.tracklist_status] += 1;
  }

  const total = counts.found + counts.absent + counts.failed + counts.pending;
  const attempted = counts.found + counts.absent + counts.failed;

  return {
    ...counts,
    total,
    observedCoveragePercent:
      attempted === 0 ? 0 : Math.round((counts.found / attempted) * 1000) / 10,
  };
}
