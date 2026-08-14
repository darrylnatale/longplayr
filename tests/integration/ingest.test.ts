import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  collaborationAlbum,
  messyReleaseGroup,
  mixtapeWithoutPrimaryType,
  multiDiscAlbum,
  singleArtistAlbum,
  singleRelease,
  variousArtistsCompilation,
  yearOnlyAlbum,
} from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Ingestion against a real database, driven entirely by fixtures.
 *
 * No network access: live MusicBrainz calls stay blocked until a genuine
 * contact value is configured. These prove the write path — upserts,
 * idempotency, credit replacement, scope enforcement — not that our reading of
 * MusicBrainz is correct. That is what the real-data smoke test is for.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function clearCatalogue() {
  // albums cascade to album_artists, releases and tracks.
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(clearCatalogue);
afterAll(clearCatalogue);

describe('ingestReleaseGroupPayload', () => {
  it('ingests an album with its artist, release and tracks', async () => {
    const result = await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    expect(result.status).toBe('ingested');

    const { data: album } = await admin
      .from('albums')
      .select(
        '*, album_artists(position, artists(name)), releases!releases_album_id_fkey(mbid, label, tracks(title))',
      )
      .eq('mbid', singleArtistAlbum.id)
      .single();

    expect(album?.title).toBe('In Rainbows');
    expect(album?.display_credit).toBe('Radiohead');
    expect(album?.primary_type).toBe('album');
    expect(album?.album_artists).toHaveLength(1);
    expect(album?.releases[0].label).toBe('XL Recordings');
    expect(album?.releases[0].tracks).toHaveLength(2);
  });

  it('is idempotent — re-ingesting creates no duplicates', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);

    const counts = await Promise.all([
      admin.from('albums').select('id', { count: 'exact', head: true }),
      admin.from('artists').select('id', { count: 'exact', head: true }),
      admin.from('releases').select('id', { count: 'exact', head: true }),
      admin.from('tracks').select('id', { count: 'exact', head: true }),
    ]);

    expect(counts.map((c) => c.count)).toEqual([1, 1, 1, 2]);
  });

  it('links a collaboration to every credited artist', async () => {
    await ingestReleaseGroupPayload(collaborationAlbum, admin);

    const { data } = await admin
      .from('album_artists')
      .select('position, artists(name)')
      .order('position');

    // The whole reason album_artists exists: this album must be reachable from
    // both artists' pages.
    expect(data?.map((row) => row.artists?.name)).toEqual(['JAY-Z', 'Kanye West']);
  });

  it('removes a credit that upstream has dropped', async () => {
    await ingestReleaseGroupPayload(collaborationAlbum, admin);

    const reduced = {
      ...collaborationAlbum,
      'artist-credit': [collaborationAlbum['artist-credit']![0]],
    };
    await ingestReleaseGroupPayload(reduced, admin);

    const { data } = await admin.from('album_artists').select('artists(name)');
    expect(data?.map((row) => row.artists?.name)).toEqual(['JAY-Z']);
  });

  it('refuses a single and writes nothing', async () => {
    const result = await ingestReleaseGroupPayload(singleRelease, admin);

    expect(result.status).toBe('out_of_scope');
    const { count } = await admin.from('albums').select('id', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  it('accepts a mixtape with no primary type, and a Various Artists compilation', async () => {
    await ingestReleaseGroupPayload(mixtapeWithoutPrimaryType, admin);
    await ingestReleaseGroupPayload(variousArtistsCompilation, admin);

    const { data } = await admin.from('albums').select('title, primary_type, secondary_types');
    const byTitle = Object.fromEntries(data!.map((a) => [a.title, a]));

    expect(byTitle['Acid Rap'].secondary_types).toEqual(['mixtape']);
    expect(byTitle['Now That’s What I Call Music! 100'].secondary_types).toEqual(['compilation']);
  });

  it('stores year-only precision without inventing a day', async () => {
    await ingestReleaseGroupPayload(yearOnlyAlbum, admin);

    const { data } = await admin
      .from('albums')
      .select('first_release_date, first_release_date_precision')
      .single();

    expect(data?.first_release_date).toBe('1979-01-01');
    expect(data?.first_release_date_precision).toBe('year');
  });

  it('sets the representative release deterministically', async () => {
    await ingestReleaseGroupPayload(messyReleaseGroup, admin);

    const { data } = await admin
      .from('albums')
      .select('representative_release_id, releases!releases_album_id_fkey(id, mbid)')
      .single();

    const chosen = data?.releases.find((r) => r.id === data.representative_release_id);
    expect(chosen?.mbid).toBe('00000000-0000-4000-8000-0000000000a1');
  });

  it('keeps the same representative release across re-ingests', async () => {
    await ingestReleaseGroupPayload(messyReleaseGroup, admin);
    const first = await admin.from('albums').select('representative_release_id').single();

    // Reversed release order, as MusicBrainz might legitimately return.
    await ingestReleaseGroupPayload(
      { ...messyReleaseGroup, releases: [...messyReleaseGroup.releases!].reverse() },
      admin,
    );
    const second = await admin.from('albums').select('representative_release_id').single();

    // A tracklist that changes on re-sync would be genuinely hard to trace.
    expect(second.data?.representative_release_id).toBe(first.data?.representative_release_id);
  });

  it('stores multi-disc tracklists without position collisions', async () => {
    await ingestReleaseGroupPayload(multiDiscAlbum, admin);

    const { data } = await admin
      .from('tracks')
      .select('position, medium_position, title')
      .order('medium_position');

    expect(data).toEqual([
      { position: 1, medium_position: 1, title: 'The Magnificent Seven' },
      { position: 1, medium_position: 2, title: 'Lose This Skin' },
    ]);
  });

  it('replaces a tracklist rather than appending to it', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);

    const shortened = structuredClone(singleArtistAlbum);
    shortened.releases![0].media![0].tracks = [
      { id: 't1', position: 1, title: '15 Step', length: 237000 },
    ];
    await ingestReleaseGroupPayload(shortened, admin);

    const { count } = await admin.from('tracks').select('id', { count: 'exact', head: true });
    expect(count).toBe(1);
  });

  it('updates metadata when upstream changes', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await ingestReleaseGroupPayload(
      { ...singleArtistAlbum, title: 'In Rainbows (Remastered)' },
      admin,
    );

    const { data, count } = await admin
      .from('albums')
      .select('title', { count: 'exact' })
      .eq('mbid', singleArtistAlbum.id);

    expect(count).toBe(1);
    expect(data?.[0].title).toBe('In Rainbows (Remastered)');
  });

  it('handles a release group with no releases at all', async () => {
    const result = await ingestReleaseGroupPayload(variousArtistsCompilation, admin);
    expect(result.status).toBe('ingested');

    const { data } = await admin.from('albums').select('representative_release_id').single();
    expect(data?.representative_release_id).toBeNull();
  });
});
