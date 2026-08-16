import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  ARTWORK_BUCKET,
  artworkCoverage,
  artworkPath,
  coverArtUrl,
  fetchAndStoreArtwork,
} from '@/services/catalogue/artwork';
import { singleArtistAlbum, yearOnlyAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Artwork against real storage, with Cover Art Archive stubbed.
 *
 * Stubbing the fetch keeps these deterministic and offline; the real-data smoke
 * test is what proves our reading of CAA is correct.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** A one-pixel JPEG, enough to prove bytes round-trip through storage. */
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

/**
 * Intercepts Cover Art Archive only.
 *
 * supabase-js talks to the database over fetch too, so a blanket stub would
 * break every query in the test — which it did, the first time.
 */
function stubCoverArt(behaviour: (url: string) => Response) {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('coverartarchive.org')) return behaviour(url);
    return realFetch(input as RequestInfo, init);
  });
}

const imageResponse = () =>
  new Response(JPEG_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } });
const notFound = () => new Response(null, { status: 404 });

async function clear() {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  const { data } = await admin.storage.from(ARTWORK_BUCKET).list();
  for (const entry of data ?? []) {
    const { data: inner } = await admin.storage.from(ARTWORK_BUCKET).list(entry.name);
    await admin.storage
      .from(ARTWORK_BUCKET)
      .remove((inner ?? []).map((f) => `${entry.name}/${f.name}`));
  }
}

beforeEach(clear);
afterEach(() => vi.restoreAllMocks());
afterAll(clear);

describe('coverArtUrl', () => {
  it('addresses the release group directly, so a cover cannot land on the wrong album', () => {
    expect(coverArtUrl('abc-123', 500)).toBe(
      'https://coverartarchive.org/release-group/abc-123/front-500',
    );
  });
});

describe('fetchAndStoreArtwork', () => {
  it('stores every size and marks the album found', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    stubCoverArt(imageResponse);

    const result = await fetchAndStoreArtwork(singleArtistAlbum.id, admin);

    expect(result).toEqual({ status: 'found', sizes: [250, 500, 1200] });

    const { data: album } = await admin
      .from('albums')
      .select('artwork_status, artwork_updated_at')
      .eq('mbid', singleArtistAlbum.id)
      .single();
    expect(album?.artwork_status).toBe('found');
    expect(album?.artwork_updated_at).not.toBeNull();

    const { data: files } = await admin.storage.from(ARTWORK_BUCKET).list(singleArtistAlbum.id);
    expect(files?.map((f) => f.name).sort()).toEqual(['1200.jpg', '250.jpg', '500.jpg']);
  });

  it('marks an album absent when Cover Art Archive has nothing', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    stubCoverArt(notFound);

    const result = await fetchAndStoreArtwork(singleArtistAlbum.id, admin);

    expect(result.status).toBe('absent');

    // Recording absence is what separates "no art" from "never attempted".
    const { data } = await admin
      .from('albums')
      .select('artwork_status')
      .eq('mbid', singleArtistAlbum.id)
      .single();
    expect(data?.artwork_status).toBe('absent');
  });

  it('stores nothing when there is no cover', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    stubCoverArt(notFound);
    await fetchAndStoreArtwork(singleArtistAlbum.id, admin);

    const { data } = await admin.storage.from(ARTWORK_BUCKET).list(singleArtistAlbum.id);
    expect(data ?? []).toHaveLength(0);
  });

  it('serves stored artwork publicly', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    stubCoverArt(imageResponse);
    await fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500]);
    vi.restoreAllMocks();

    // Covers are public: fetched with no credentials at all.
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${ARTWORK_BUCKET}/${artworkPath(singleArtistAlbum.id, 500)}`;
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image');
  });

  it('replaces existing artwork on a re-fetch rather than failing', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    stubCoverArt(imageResponse);

    await fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500]);
    const second = await fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500]);

    expect(second.status).toBe('found');
  });
});

describe('artworkCoverage', () => {
  it('reports found, absent and pending separately', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await ingestReleaseGroupPayload(yearOnlyAlbum, admin);

    // Both start pending, so coverage is undefined rather than zero-with-data.
    expect(await artworkCoverage(admin)).toMatchObject({
      found: 0,
      absent: 0,
      failed: 0,
      pending: 2,
    });

    stubCoverArt(imageResponse);
    await fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500]);
    vi.restoreAllMocks();
    stubCoverArt(notFound);
    await fetchAndStoreArtwork(yearOnlyAlbum.id, admin, [500]);

    const coverage = await artworkCoverage(admin);
    expect(coverage).toMatchObject({ found: 1, absent: 1, pending: 0, total: 2 });
    expect(coverage.observedCoveragePercent).toBe(50);
  });

  it('excludes pending albums from the percentage', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await ingestReleaseGroupPayload(yearOnlyAlbum, admin);
    stubCoverArt(imageResponse);
    await fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500]);

    // One found, one still pending: 100% of what has been attempted, not 50%.
    const coverage = await artworkCoverage(admin);
    expect(coverage).toMatchObject({ found: 1, pending: 1 });
    expect(coverage.observedCoveragePercent).toBe(100);
  });
});

describe('artwork failure is distinct from absence', () => {
  it('records failed, not absent, when Cover Art Archive errors', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    stubCoverArt(() => new Response(null, { status: 500 }));

    const result = await fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500]);

    // A 500 says nothing about whether artwork exists. Calling it 'absent'
    // would record a permanent gap for a temporary outage.
    expect(result.status).toBe('failed');

    const { data } = await admin
      .from('albums')
      .select('artwork_status')
      .eq('mbid', singleArtistAlbum.id)
      .single();
    expect(data?.artwork_status).toBe('failed');
  });

  it('does not throw on a Cover Art Archive error', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    stubCoverArt(() => new Response(null, { status: 503 }));

    // Previously this propagated and was counted as a catalogue failure, which
    // conflated "we could not fetch a cover" with "we could not ingest".
    await expect(fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500])).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('counts failures in the denominator, never hiding them', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await ingestReleaseGroupPayload(yearOnlyAlbum, admin);

    stubCoverArt(imageResponse);
    await fetchAndStoreArtwork(singleArtistAlbum.id, admin, [500]);
    vi.restoreAllMocks();
    stubCoverArt(() => new Response(null, { status: 500 }));
    await fetchAndStoreArtwork(yearOnlyAlbum.id, admin, [500]);

    const coverage = await artworkCoverage(admin);

    // One found, one failed. The old metric reported 100% here.
    expect(coverage).toMatchObject({ found: 1, absent: 0, failed: 1, pending: 0 });
    expect(coverage.observedCoveragePercent).toBe(50);
  });
});
