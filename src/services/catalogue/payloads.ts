import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/database.types';

type Admin = SupabaseClient<Database>;

/**
 * Verbatim upstream responses.
 *
 * Ingestion maps a deliberate subset of each response into columns and drops
 * the rest. This keeps the rest. The reasoning lives in the migration; the
 * short version is that label MBIDs, recording MBIDs, external links and
 * relationship credits all arrive in requests we already make, and recovering
 * any of them later costs one rate-limited round trip per album — forever.
 *
 * **Storing is not modelling.** Nothing reads these yet, and nothing should
 * until a feature needs a field, at which point the work is a local reshape
 * rather than a re-fetch. Resist the temptation to query `payload->>'...'` from
 * a product surface: a column exists for that, and adding one is cheap now that
 * the data is on disk.
 */

/** The only source today. Discogs is recorded direction, not a value in use. */
export const MUSICBRAINZ = 'musicbrainz';

/** The response shapes we request. Closed, because they are ours to close. */
export type UpstreamPayloadKind = 'release_group' | 'release' | 'artist';

/**
 * Records one upstream response, replacing any previous snapshot of it.
 *
 * **Upsert rather than insert**, because re-ingesting an album is routine — a
 * backfill, a retry, a user adding a record we already hold — and the table is
 * a cache of the latest answer rather than a history of them. `fetched_at`
 * moves with it, which is what a refresh policy would key on if one is ever
 * decided.
 *
 * **Throws on failure, deliberately.** Artwork and tracklists return outcomes
 * because an unreachable third party is an expected fact about the world. This
 * is a local write to our own database: if it fails, something is wrong that a
 * caller cannot sensibly render (`services/result.ts`).
 */
export async function storeUpstreamPayload(
  admin: Admin,
  kind: UpstreamPayloadKind,
  sourceId: string,
  payload: unknown,
  source: string = MUSICBRAINZ,
): Promise<void> {
  const { error } = await admin.from('upstream_payloads').upsert(
    {
      source,
      source_id: sourceId,
      kind,
      payload: payload as never,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'source,source_id,kind' },
  );

  if (error) throw error;
}

/**
 * Which of these identifiers we hold a payload of this kind for.
 *
 * Exists so the backfill sweep can ask once for a batch rather than once per
 * album, the same shape `enqueueMissingArtwork` uses to find outstanding jobs.
 */
export async function heldPayloadIds(
  admin: Admin,
  kind: UpstreamPayloadKind,
  sourceIds: string[],
  source: string = MUSICBRAINZ,
): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set();

  const { data, error } = await admin
    .from('upstream_payloads')
    .select('source_id')
    .eq('source', source)
    .eq('kind', kind)
    .in('source_id', sourceIds);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.source_id));
}
