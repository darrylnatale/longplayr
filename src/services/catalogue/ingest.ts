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
import { getRelease, getReleaseGroup, NotFoundError } from './musicbrainz';
import { storeUpstreamPayload } from './payloads';
import { enqueueJob } from './queue';
import { recordTracklistStatus, storeTracklist, type TracklistResult } from './tracklist';

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
  | {
      status: 'ingested';
      albumId: string;
      mbid: string;
      /**
       * What happened to the tracklist, reported separately.
       *
       * The album succeeding and its tracklist succeeding are two outcomes, and
       * collapsing them is what produced 44 albums that looked ingested and had
       * no tracks. Undefined only when no fetcher was supplied.
       */
      tracklist?: TracklistResult;
    }
  | { status: 'out_of_scope'; mbid: string; reason: string };

/**
 * What the injected tracklist fetcher reports back.
 *
 * Deliberately not `MappedRelease | null`. Null cannot distinguish "this
 * release has no tracks" from "we never got an answer", and that distinction is
 * the entire point — one is a fact about the release, the other is a fact about
 * the network, and only the second should be retried.
 */
export type ReleaseDetailOutcome =
  | { status: 'fetched'; detail: MappedRelease }
  | { status: 'absent'; reason: string }
  | { status: 'failed'; reason: string };

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
/**
 * Upserts the album row and settles its hydration state.
 *
 * **Hydration is never downgraded.** A curated artist may be re-processed after
 * a transient upstream failure, and its release groups may already have been
 * ingested in full — by an earlier run, or by another artist crediting the same
 * record. Writing `pending` over those would leave `pending` alongside a
 * populated `representative_release_id`, a combination the model does not
 * define, and would tell every sweep the album still needed fetching.
 *
 * The column is therefore written in a second statement rather than as part of
 * the upsert: the upsert omits it, so the value the row already carries is what
 * comes back, and `pending` is only ever reached through the column default on
 * insert. There is no path that writes `pending` over an existing row.
 */
async function upsertAlbum(
  admin: Admin,
  mapped: MappedAlbum,
  hydration: HydrationState,
): Promise<string> {
  const { data, error } = await admin
    .from('albums')
    .upsert(mapped.album, { onConflict: 'mbid' })
    .select('id, hydration_status')
    .single();

  if (error) throw error;

  const resolved: HydrationState = hydration === 'fetched' ? 'fetched' : data.hydration_status;

  const { error: stateError } = await admin
    .from('albums')
    .update({ hydration_status: resolved, hydration_updated_at: new Date().toISOString() })
    .eq('id', data.id);

  if (stateError) throw stateError;
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
 * Ingests one release group from an already-fetched MusicBrainz payload.
 *
 * Separated from fetching so it can be tested against fixtures without any
 * network access — which matters while live calls are deliberately blocked.
 */
export type HydrationState = Database['public']['Enums']['hydration_status'];

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
  fetchReleaseDetail?: (mbid: string) => Promise<ReleaseDetailOutcome>,
  /**
   * Hydration provenance, stated by the caller.
   *
   * **A compatibility default, not a provenance mechanism.** Every existing
   * caller passes a full release-group payload, so `fetched` is correct for all
   * of them and none had to change. The minimal path must pass `pending`
   * explicitly — see `createMinimalAlbum`.
   *
   * **Nothing here inspects the payload to decide.** A browse response and a
   * full response are both valid inputs and can look alike; guessing between
   * them from shape is exactly what `hydration_status` exists to avoid.
   */
  options: { hydration?: HydrationState } = {},
): Promise<IngestResult> {
  const hydration: HydrationState = options.hydration ?? 'fetched';
  let tracklist: TracklistResult | undefined;
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

  // Kept before anything is mapped into columns, and after the scope filter:
  // a single we refused is not a record we hold, so there is nothing to keep a
  // payload for. Everything past this point is an album we are committing to.
  await storeUpstreamPayload(admin, 'release_group', payload.id, payload);

  const artistIds = await upsertArtists(admin, mapped);
  const albumId = await upsertAlbum(admin, mapped, hydration);
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
      const outcome = await fetchReleaseDetail(mapped.representativeReleaseMbid);

      if (outcome.status === 'fetched') {
        tracklist = await storeTracklist(admin, representativeId, outcome.detail);
      } else {
        // The album stays. A tracklist we could not reach is not a reason to
        // discard metadata that arrived intact — but it is recorded, and it is
        // queued, because the previous version did neither and left 44 albums
        // permanently trackless with nothing pointing at them.
        tracklist = { status: outcome.status, reason: outcome.reason };
        await recordTracklistStatus(admin, representativeId, outcome.status);

        if (outcome.status === 'failed') {
          await enqueueJob('fetch_tracklist', mapped.representativeReleaseMbid, { admin });
        }
      }
    }
  }

  return { status: 'ingested', albumId, mbid: mapped.album.mbid, tracklist };
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
      // Stored here rather than inside `ingestReleaseGroupPayload`, because
      // this is where the fetch happens: the callback hands back a mapped
      // detail, and the raw response exists only in this closure. Whoever
      // fetches, stores. A fixture-driven caller passes no callback and
      // therefore records no release payload, which is correct — nothing was
      // fetched.
      const raw = await getRelease(releaseMbid);
      await storeUpstreamPayload(admin, 'release', releaseMbid, raw);
      return { status: 'fetched', detail: mapReleaseDetail(raw) };
    } catch (error) {
      // A missing or broken tracklist still must not fail an otherwise good
      // album — but which kind of missing it is now gets reported, rather than
      // flattened into a null the caller could only read as "no tracks".
      if (error instanceof NotFoundError) {
        return {
          status: 'absent',
          reason: `MusicBrainz no longer resolves release ${releaseMbid}`,
        };
      }
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * Creates an album from a **browse** response, without fetching its detail.
 *
 * This is the write half of progressive hydration (`docs/architecture.md` §7).
 * A browse record carries every column an album card needs — title, credit,
 * primary type, first release date and the MBID — and no releases at all, so
 * the album is created complete in identity and incomplete in detail.
 *
 * **Costs zero MusicBrainz requests.** The browse response has already been
 * fetched by the caller; nothing here goes upstream. The two requests a full
 * ingest would spend are deferred until someone opens the album.
 *
 * **Passes `pending` explicitly**, never relying on the compatibility default,
 * because the provenance of this row is the whole point of recording it.
 */
export async function createMinimalAlbum(
  browseRecord: Parameters<typeof mapReleaseGroup>[0],
  admin: Admin = createAdminClient(),
): Promise<IngestResult> {
  return ingestReleaseGroupPayload(browseRecord, admin, undefined, { hydration: 'pending' });
}
