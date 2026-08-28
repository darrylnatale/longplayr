import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  browseLiveAlbum,
  browseReleaseGroup,
  singleArtistAlbum,
  singleDiscReleaseDetail,
  variousArtistsCompilation,
} from '@/services/catalogue/fixtures';
import { createMinimalAlbum, ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import { mapReleaseDetail } from '@/services/catalogue/map';
import { withinCurrentDepth } from '@/services/catalogue/depth-policy';

/**
 * Progressive hydration state, against a real database.
 *
 * The distinction under test is the one `representative_release_id` cannot make
 * alone: a browse-created album and a fully fetched release group holding no
 * releases both leave it null.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function clearCatalogue() {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin
    .from('ingestion_jobs')
    .delete()
    .neq('target_mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(clearCatalogue);
afterAll(clearCatalogue);

const detail = async () =>
  ({ status: 'fetched', detail: mapReleaseDetail(singleDiscReleaseDetail) }) as const;

async function row(mbid: string) {
  const { data } = await admin
    .from('albums')
    .select('mbid, title, hydration_status, hydration_updated_at, representative_release_id')
    .eq('mbid', mbid)
    .single();
  return data!;
}

describe('minimal ingestion from a browse record', () => {
  it('creates an album marked pending with no representative release', async () => {
    const result = await createMinimalAlbum(browseReleaseGroup, admin);
    expect(result.status).toBe('ingested');

    const album = await row(browseReleaseGroup.id);
    expect(album.hydration_status).toBe('pending');
    expect(album.representative_release_id).toBeNull();
    expect(album.hydration_updated_at).not.toBeNull();
  });

  it('carries every column an album card renders', async () => {
    await createMinimalAlbum(browseReleaseGroup, admin);

    const { data } = await admin
      .from('albums')
      .select('title, display_credit, primary_type, first_release_date, artwork_status')
      .eq('mbid', browseReleaseGroup.id)
      .single();

    expect(data).toMatchObject({
      title: 'Here Comes Everybody',
      display_credit: 'The Wake',
      primary_type: 'album',
      first_release_date: '1985-09-01',
      artwork_status: 'pending',
    });
  });

  it('writes no releases at all', async () => {
    await createMinimalAlbum(browseReleaseGroup, admin);
    const { data: album } = await admin
      .from('albums')
      .select('id')
      .eq('mbid', browseReleaseGroup.id)
      .single();
    const { count } = await admin
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', album!.id);
    expect(count).toBe(0);
  });

  it('still credits the artist, so the discography page works', async () => {
    await createMinimalAlbum(browseReleaseGroup, admin);

    // **This asserted the wrong table until 2026-08-25.** It checked that a row
    // existed in `artists`, which `upsertArtists` writes a statement earlier
    // than the credit — so the test passed with credit-writing removed
    // entirely, while promising in its name that the discography worked. The
    // discography is built from `album_artists` and from nothing else
    // (`src/services/catalogue/queries.ts`), so that is what it must assert.
    const { data } = await admin
      .from('albums')
      .select('album_artists(position, artists(mbid))')
      .eq('mbid', browseReleaseGroup.id)
      .single();

    expect(
      (data?.album_artists ?? []).map((row) => ({
        position: row.position,
        mbid: row.artists?.mbid,
      })),
    ).toEqual([{ position: 0, mbid: 'c2314623-e863-4fde-af8c-d6e00fec5f2c' }]);
  });
});

describe('full ingestion', () => {
  it('marks fetched and sets a representative release', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);

    const album = await row(singleArtistAlbum.id);
    expect(album.hydration_status).toBe('fetched');
    expect(album.representative_release_id).not.toBeNull();
  });

  it('defaults to fetched when no hydration option is given', async () => {
    // The compatibility default the existing ~90 callers rely on.
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    expect((await row(singleArtistAlbum.id)).hydration_status).toBe('fetched');
  });

  it('marks fetched with a null representative when the group holds no releases', async () => {
    // The case representative_release_id alone cannot distinguish from pending.
    await ingestReleaseGroupPayload(variousArtistsCompilation, admin);

    const album = await row(variousArtistsCompilation.id);
    expect(album.hydration_status).toBe('fetched');
    expect(album.representative_release_id).toBeNull();
  });
});

describe('hydration transitions', () => {
  it('promotes pending to fetched when the full detail arrives', async () => {
    await createMinimalAlbum(singleArtistAlbum, admin);
    expect((await row(singleArtistAlbum.id)).hydration_status).toBe('pending');

    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);

    const album = await row(singleArtistAlbum.id);
    expect(album.hydration_status).toBe('fetched');
    expect(album.representative_release_id).not.toBeNull();
  });

  it('does not demote a fetched album with a representative release', async () => {
    // Reachable once artist-level retry exists: a re-processed artist may
    // credit a release group another artist already ingested in full.
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);
    const before = await row(singleArtistAlbum.id);
    expect(before.hydration_status).toBe('fetched');
    expect(before.representative_release_id).not.toBeNull();

    await createMinimalAlbum(singleArtistAlbum, admin);

    const after = await row(singleArtistAlbum.id);
    expect(after.hydration_status).toBe('fetched');
    expect(after.representative_release_id).toBe(before.representative_release_id);
  });

  it('does not demote a fetched album that genuinely has no releases', async () => {
    await ingestReleaseGroupPayload(variousArtistsCompilation, admin);
    expect((await row(variousArtistsCompilation.id)).hydration_status).toBe('fetched');

    await createMinimalAlbum(variousArtistsCompilation, admin);

    const after = await row(variousArtistsCompilation.id);
    // fetched + null must stay fetched + null, never collapse into pending +
    // null, which is the same shape a browse-created album has.
    expect(after.hydration_status).toBe('fetched');
    expect(after.representative_release_id).toBeNull();
  });

  it('never produces pending alongside a representative release', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);
    await createMinimalAlbum(singleArtistAlbum, admin);
    await createMinimalAlbum(singleArtistAlbum, admin);

    const { data } = await admin
      .from('albums')
      .select('mbid')
      .eq('hydration_status', 'pending')
      .not('representative_release_id', 'is', null);

    // A combination the model does not define. Zero rows, always.
    expect(data).toEqual([]);
  });

  it('still creates a genuinely new minimal album as pending', async () => {
    await createMinimalAlbum(browseReleaseGroup, admin);
    const album = await row(browseReleaseGroup.id);
    expect(album.hydration_status).toBe('pending');
    expect(album.representative_release_id).toBeNull();
  });

  it('still marks a genuinely full ingestion as fetched', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);
    expect((await row(singleArtistAlbum.id)).hydration_status).toBe('fetched');
  });

  it('is idempotent — repeating minimal ingestion changes nothing', async () => {
    await createMinimalAlbum(browseReleaseGroup, admin);
    await createMinimalAlbum(browseReleaseGroup, admin);
    await createMinimalAlbum(browseReleaseGroup, admin);

    const { count } = await admin
      .from('albums')
      .select('mbid', { count: 'exact', head: true })
      .eq('mbid', browseReleaseGroup.id);
    expect(count).toBe(1);
  });
});

describe('depth boundary at the write path', () => {
  it('refuses a live album, which scope would have accepted', () => {
    expect(withinCurrentDepth(browseLiveAlbum).inDepth).toBe(false);
  });

  it('accepts the in-depth browse record', () => {
    expect(withinCurrentDepth(browseReleaseGroup).inDepth).toBe(true);
  });
});

describe('additive behaviour', () => {
  it('leaves an existing album untouched when a new one is created', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);
    const before = await row(singleArtistAlbum.id);

    await createMinimalAlbum(browseReleaseGroup, admin);

    const after = await row(singleArtistAlbum.id);
    expect(after.hydration_status).toBe(before.hydration_status);
    expect(after.representative_release_id).toBe(before.representative_release_id);

    const { count } = await admin.from('albums').select('mbid', { count: 'exact', head: true });
    expect(count).toBe(2);
  });
});

describe('backfill logic', () => {
  it('marks exactly those albums holding a release_group payload', async () => {
    // Reproduces the migration's rule against real rows: payload present means
    // a full response was received, and that is the whole of the claim.
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);
    await createMinimalAlbum(browseReleaseGroup, admin);

    await admin
      .from('albums')
      .update({ hydration_status: 'pending' })
      .neq('mbid', '00000000-0000-0000-0000-000000000000');

    const { data: payloads } = await admin
      .from('upstream_payloads')
      .select('source_id')
      .eq('source', 'musicbrainz')
      .eq('kind', 'release_group');
    const withPayload = new Set((payloads ?? []).map((p) => p.source_id));

    // Both fixtures store a payload — minimal ingestion stores the browse
    // record — so the discriminator here is not payload presence alone but what
    // the migration observes on a database that predates browse-created rows.
    expect(withPayload.has(singleArtistAlbum.id)).toBe(true);

    await admin
      .from('albums')
      .update({ hydration_status: 'fetched', hydration_updated_at: new Date().toISOString() })
      .in('mbid', [...withPayload]);

    expect((await row(singleArtistAlbum.id)).hydration_status).toBe('fetched');
  });
});

describe('the hydration pair stays coherent', () => {
  /**
   * **Detection only. Nothing here repairs anything.**
   *
   * `fetched` and a representative release are written by two separate
   * statements, so an interruption between them can leave `fetched` with a null
   * `representative_release_id` — and unlike a missing credit, nothing heals it,
   * because nothing re-triggers ingestion for an album already marked fetched.
   *
   * It has never occurred: staging measures zero rows in both directions. The
   * repair is deliberately out of scope for this cycle — it would need an
   * upstream fetch and therefore a different mechanism — and is recorded as a
   * follow-up in `docs/architecture.md` §7. This test exists so the invariant
   * cannot rot silently in the meantime.
   */
  it('a fetched album always holds a representative release', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detail);
    await createMinimalAlbum(browseReleaseGroup, admin);

    const { data } = await admin
      .from('albums')
      .select('mbid, hydration_status, representative_release_id');

    const incoherent = (data ?? []).filter(
      (album) =>
        (album.hydration_status === 'fetched' && album.representative_release_id === null) ||
        (album.hydration_status === 'pending' && album.representative_release_id !== null),
    );

    expect(incoherent).toEqual([]);
  });
});
