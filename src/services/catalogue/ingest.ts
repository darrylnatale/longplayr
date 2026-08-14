import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

import {
  mapReleaseDetail,
  mapReleaseGroup,
  OutOfScopeError,
  type MappedAlbum,
  type MappedRelease,
} from './map';
import { getRelease, getReleaseGroup } from './musicbrainz';

type Admin = SupabaseClient<Database>;

/**
 * Catalogue ingestion.
 *
 * Everything here is an upsert keyed on MBID, so re-ingesting an album updates
 * rather than duplicating. That property is what makes re-syncing safe and is
 * covered directly by integration tests.
 *
 * Writes use the service role: the catalogue is not user-authored, and no user
 * has write access to it.
 */

export type IngestResult =
  | { status: 'ingested'; albumId: string; mbid: string }
  | { status: 'out_of_scope'; mbid: string; reason: string };

/** Upserts artists, returning MBID → row id. */
async function upsertArtists(admin: Admin, mapped: MappedAlbum): Promise<Map<string, string>> {
  const byMbid = new Map<string, string>();
  if (mapped.artists.length === 0) return byMbid;

  const rows = mapped.artists.map(({ artist }) => artist);

  const { data, error } = await admin
    .from('artists')
    .upsert(rows, { onConflict: 'mbid' })
    .select('id, mbid');

  if (error) throw error;
  for (const row of data ?? []) byMbid.set(row.mbid, row.id);
  return byMbid;
}

/** Upserts the album row itself, without its representative release. */
async function upsertAlbum(admin: Admin, mapped: MappedAlbum): Promise<string> {
  const { data, error } = await admin
    .from('albums')
    .upsert(mapped.album, { onConflict: 'mbid' })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function replaceCredits(
  admin: Admin,
  albumId: string,
  mapped: MappedAlbum,
  artistIds: Map<string, string>,
): Promise<void> {
  const rows = mapped.artists
    .map(({ artist, position }) => {
      const artistId = artistIds.get(artist.mbid);
      return artistId ? { album_id: albumId, artist_id: artistId, position } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return;

  // Credits can change upstream — an artist removed from a collaboration must
  // disappear here too, so this is a replace rather than an append.
  const { error: deleteError } = await admin
    .from('album_artists')
    .delete()
    .eq('album_id', albumId)
    .not('artist_id', 'in', `(${rows.map((r) => r.artist_id).join(',')})`);
  if (deleteError) throw deleteError;

  const { error } = await admin
    .from('album_artists')
    .upsert(rows, { onConflict: 'album_id,artist_id' });
  if (error) throw error;
}

/** Upserts release metadata, returning MBID → row id. Tracks are separate. */
async function upsertReleases(
  admin: Admin,
  albumId: string,
  mapped: MappedAlbum,
): Promise<Map<string, string>> {
  const byMbid = new Map<string, string>();
  if (mapped.releases.length === 0) return byMbid;

  const rows = mapped.releases.map(({ release }) => ({ ...release, album_id: albumId }));

  const { data, error } = await admin
    .from('releases')
    .upsert(rows, { onConflict: 'mbid' })
    .select('id, mbid');
  if (error) throw error;

  for (const row of data ?? []) byMbid.set(row.mbid, row.id);
  return byMbid;
}

/**
 * Writes the tracklist for one release, replacing whatever was there.
 *
 * Wholesale replacement rather than diffing: tracklists are small, and upstream
 * corrections routinely renumber or retitle tracks, which a diff would handle
 * worse than a rewrite.
 */
async function replaceTracks(
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

/**
 * Ingests one release group from an already-fetched MusicBrainz payload.
 *
 * Separated from fetching so it can be tested against fixtures without any
 * network access — which matters while live calls are deliberately blocked.
 */
export async function ingestReleaseGroupPayload(
  payload: Parameters<typeof mapReleaseGroup>[0],
  admin: Admin = createAdminClient(),
  /**
   * Supplies the representative release's tracklist.
   *
   * Injected rather than called directly so the write path stays testable
   * without network access. In production this is a second MusicBrainz request
   * per album — release-group responses carry no tracklist, so there is no way
   * to avoid it.
   */
  fetchReleaseDetail?: (mbid: string) => Promise<MappedRelease | null>,
): Promise<IngestResult> {
  let mapped: MappedAlbum;
  try {
    mapped = mapReleaseGroup(payload);
  } catch (error) {
    if (error instanceof OutOfScopeError) {
      // Not a failure. Refusing a single is the system working.
      return { status: 'out_of_scope', mbid: payload.id, reason: error.reason };
    }
    throw error;
  }

  const artistIds = await upsertArtists(admin, mapped);
  const albumId = await upsertAlbum(admin, mapped);
  await replaceCredits(admin, albumId, mapped, artistIds);
  const releaseIds = await upsertReleases(admin, albumId, mapped);

  // Set last: the representative release must exist before the album can point
  // at it.
  const representativeId = mapped.representativeReleaseMbid
    ? (releaseIds.get(mapped.representativeReleaseMbid) ?? null)
    : null;

  if (representativeId && mapped.representativeReleaseMbid) {
    const { error } = await admin
      .from('albums')
      .update({ representative_release_id: representativeId })
      .eq('id', albumId);
    if (error) throw error;

    // Only the representative release gets a tracklist. Fetching every edition
    // would cost one request each against a one-per-second budget, for data no
    // page currently shows.
    if (fetchReleaseDetail) {
      const detail = await fetchReleaseDetail(mapped.representativeReleaseMbid);
      if (detail) await replaceTracks(admin, representativeId, detail);
    }
  }

  return { status: 'ingested', albumId, mbid: mapped.album.mbid };
}

/**
 * Fetches a release group from MusicBrainz and ingests it.
 *
 * Costs **two** MusicBrainz requests: one for the release group, one for the
 * representative release's tracklist. Both go through the shared rate limiter,
 * which serialises them — so ingestion runs at roughly two seconds per album
 * and never exceeds one request per second.
 */
export async function ingestReleaseGroup(
  mbid: string,
  admin: Admin = createAdminClient(),
): Promise<IngestResult> {
  const payload = await getReleaseGroup(mbid);

  return ingestReleaseGroupPayload(payload, admin, async (releaseMbid) => {
    try {
      return mapReleaseDetail(await getRelease(releaseMbid));
    } catch {
      // A missing or broken tracklist must not fail an otherwise good album.
      // The album page renders without one; re-ingesting can fill it in later.
      return null;
    }
  });
}
