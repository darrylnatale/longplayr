import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  collaborationAlbum,
  singleArtistAlbum,
  singleRelease,
} from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import { enqueueMissingPayloads } from '@/services/catalogue/jobs';
import { heldPayloadIds, storeUpstreamPayload } from '@/services/catalogue/payloads';

/**
 * Raw upstream payload capture.
 *
 * The point of the table is that **nothing is lost that we already fetched**,
 * so the tests that matter are the ones proving capture happens on the single
 * ingest path and that the backfill can find what predates it.
 *
 * Nothing here reads a field out of a payload. That is deliberate: storing is
 * not modelling, and a test that asserted `payload->>'title'` would quietly
 * make the raw column a query surface it is not meant to be.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function clear() {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('upstream_payloads').delete().neq('source_id', '');
  await admin
    .from('ingestion_jobs')
    .delete()
    .neq('target_mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(clear);
afterAll(clear);

describe('capture on the ingest path', () => {
  it('stores the release-group payload verbatim', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);

    const { data } = await admin
      .from('upstream_payloads')
      .select('source, kind, payload, fetched_at')
      .eq('source_id', singleArtistAlbum.id)
      .single();

    expect(data!.source).toBe('musicbrainz');
    expect(data!.kind).toBe('release_group');
    expect(data!.fetched_at).toBeTruthy();
    // Verbatim: the whole response, not a mapped subset.
    expect(data!.payload).toEqual(singleArtistAlbum);
  });

  it('keeps a field the columns never mapped', async () => {
    // The entire justification for the table. `joinphrase` is carried in the
    // artist credit and is not a column anywhere — before this it was received
    // and dropped.
    await ingestReleaseGroupPayload(collaborationAlbum, admin);

    const { data } = await admin
      .from('upstream_payloads')
      .select('payload')
      .eq('source_id', collaborationAlbum.id)
      .single();

    const payload = data!.payload as typeof collaborationAlbum;
    expect(payload['artist-credit']![0].joinphrase).toBe(' & ');
  });

  it('stores nothing for a release group the scope filter refused', async () => {
    // A single is not a record we hold, so there is nothing to keep a payload
    // for. Storing one would leave rows with no album to belong to.
    const result = await ingestReleaseGroupPayload(singleRelease, admin);
    expect(result.status).toBe('out_of_scope');

    const { count } = await admin
      .from('upstream_payloads')
      .select('source_id', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  it('replaces rather than accumulates when an album is re-ingested', async () => {
    // Re-ingest is routine — a backfill, a retry, a user adding a record we
    // already hold. The table is a cache of the latest answer.
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    const first = await admin
      .from('upstream_payloads')
      .select('fetched_at')
      .eq('source_id', singleArtistAlbum.id)
      .single();

    await ingestReleaseGroupPayload(singleArtistAlbum, admin);

    const { data, count } = await admin
      .from('upstream_payloads')
      .select('fetched_at', { count: 'exact' })
      .eq('source_id', singleArtistAlbum.id);

    expect(count).toBe(1);
    expect(new Date(data![0].fetched_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.data!.fetched_at).getTime(),
    );
  });
});

describe('the store helper', () => {
  it('round-trips arbitrary JSON, including nesting and unicode', async () => {
    const payload = { id: 'x', nested: { list: [1, 2, { deep: true }] }, title: 'ゆらゆら帝国' };
    await storeUpstreamPayload(admin, 'artist', 'artist-1', payload);

    const { data } = await admin
      .from('upstream_payloads')
      .select('payload')
      .eq('source_id', 'artist-1')
      .single();

    expect(data!.payload).toEqual(payload);
  });

  it('keeps the three kinds separate for one identifier', async () => {
    // The primary key is (source, source_id, kind) — a release group and a
    // release can legitimately share an id namespace.
    await storeUpstreamPayload(admin, 'release_group', 'shared', { a: 1 });
    await storeUpstreamPayload(admin, 'release', 'shared', { b: 2 });

    const { count } = await admin
      .from('upstream_payloads')
      .select('source_id', { count: 'exact', head: true })
      .eq('source_id', 'shared');
    expect(count).toBe(2);
  });

  it('keeps sources separate, so a second one can arrive without collisions', async () => {
    await storeUpstreamPayload(admin, 'release_group', 'same-id', { from: 'mb' });
    await storeUpstreamPayload(admin, 'release_group', 'same-id', { from: 'dc' }, 'discogs');

    const { count } = await admin
      .from('upstream_payloads')
      .select('source_id', { count: 'exact', head: true })
      .eq('source_id', 'same-id');
    expect(count).toBe(2);
  });

  it('reports which identifiers are held, and only of the kind asked for', async () => {
    await storeUpstreamPayload(admin, 'release_group', 'a', {});
    await storeUpstreamPayload(admin, 'release', 'b', {});

    const held = await heldPayloadIds(admin, 'release_group', ['a', 'b', 'c']);
    expect(held).toEqual(new Set(['a']));
  });

  it('asks nothing of the database for an empty list', async () => {
    expect(await heldPayloadIds(admin, 'release_group', [])).toEqual(new Set());
  });
});

describe('the backfill sweep', () => {
  it('queues a re-ingest for an album with no payload', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    // Simulate an album ingested before capture existed.
    await admin.from('upstream_payloads').delete().eq('source_id', singleArtistAlbum.id);

    const result = await enqueueMissingPayloads({ admin });

    expect(result).toEqual({ candidates: 1, queued: 1 });

    const { data } = await admin.from('ingestion_jobs').select('kind, target_mbid').single();
    expect(data).toMatchObject({
      kind: 'ingest_release_group',
      target_mbid: singleArtistAlbum.id,
    });
  });

  it('skips albums that already have one', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);

    expect(await enqueueMissingPayloads({ admin })).toEqual({ candidates: 0, queued: 0 });
  });

  it('does not re-queue work already outstanding', async () => {
    // A sweep run twice should report that the second run queued nothing,
    // rather than re-reporting the same backlog.
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await admin.from('upstream_payloads').delete().eq('source_id', singleArtistAlbum.id);

    expect(await enqueueMissingPayloads({ admin })).toEqual({ candidates: 1, queued: 1 });
    expect(await enqueueMissingPayloads({ admin })).toEqual({ candidates: 1, queued: 0 });
  });

  it('reports zero for an empty catalogue rather than failing', async () => {
    expect(await enqueueMissingPayloads({ admin })).toEqual({ candidates: 0, queued: 0 });
  });
});

describe('privileges', () => {
  it('is not readable by an anonymous client', async () => {
    // Ingestion plumbing, not a product surface. The grant is withheld and RLS
    // has no permissive policy, so this is refused twice over.
    await storeUpstreamPayload(admin, 'release_group', 'secret-ish', { a: 1 });

    const { data, error } = await anon.from('upstream_payloads').select('source_id');

    expect(error ?? data).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('is not writable by an anonymous client', async () => {
    const { error } = await anon
      .from('upstream_payloads')
      .insert({ source: 'musicbrainz', source_id: 'nope', kind: 'release_group', payload: {} });

    expect(error).not.toBeNull();
  });
});
