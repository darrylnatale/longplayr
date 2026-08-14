import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import type { MbReleaseDetail } from '@/services/catalogue/musicbrainz';
import {
  collaborationAlbum,
  emptyReleaseDetail,
  multiDiscReleaseDetail,
  singleDiscReleaseDetail,
  messyReleaseGroup,
  mixtapeWithoutPrimaryType,
  multiDiscAlbum,
  singleArtistAlbum,
  singleRelease,
  variousArtistsCompilation,
  yearOnlyAlbum,
} from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import { mapReleaseDetail } from '@/services/catalogue/map';

/**
 * Stands in for the second MusicBrainz request.
 *
 * Release-group responses carry no tracklist, so ingestion fetches the
 * representative release separately. Injecting that here keeps these tests
 * offline while exercising the real two-step path.
 */
function detailFetcher(...details: MbReleaseDetail[]) {
  const byMbid = new Map(details.map((d) => [d.id, d]));
  return async (mbid: string) => {
    const detail = byMbid.get(mbid);
    return detail ? mapReleaseDetail(detail) : null;
  };
}

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
    const result = await ingestReleaseGroupPayload(
      singleArtistAlbum,
      admin,
      detailFetcher(singleDiscReleaseDetail),
    );
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
    const fetcher = detailFetcher(singleDiscReleaseDetail);
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, fetcher);
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, fetcher);
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, fetcher);

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
    await ingestReleaseGroupPayload(multiDiscAlbum, admin, detailFetcher(multiDiscReleaseDetail));

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
    await ingestReleaseGroupPayload(
      singleArtistAlbum,
      admin,
      detailFetcher(singleDiscReleaseDetail),
    );

    const shortened = structuredClone(singleDiscReleaseDetail);
    shortened.media![0].tracks = [
      { id: 't1', position: 1, number: '1', title: '15 Step', length: 237000 },
    ];
    shortened.media![0]['track-count'] = 1;
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, detailFetcher(shortened));

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

/**
 * Tracklist ingestion.
 *
 * The behaviour that was silently broken against real data: release-group
 * responses carry no tracklist, so it comes from a second request for the
 * representative release.
 */
describe('tracklists', () => {
  it('writes the tracklist from the representative release', async () => {
    await ingestReleaseGroupPayload(
      singleArtistAlbum,
      admin,
      detailFetcher(singleDiscReleaseDetail),
    );

    const { data } = await admin
      .from('tracks')
      .select('position, medium_position, title, length_ms')
      .order('position');

    expect(data).toEqual([
      { position: 1, medium_position: 1, title: '15 Step', length_ms: 237000 },
      { position: 2, medium_position: 1, title: 'Bodysnatchers', length_ms: 242000 },
    ]);
  });

  it('fills in format, label and track count, which only the detail response has', async () => {
    await ingestReleaseGroupPayload(
      singleArtistAlbum,
      admin,
      detailFetcher(singleDiscReleaseDetail),
    );

    const { data } = await admin
      .from('releases')
      .select('format, label, track_count')
      .eq('mbid', singleDiscReleaseDetail.id)
      .single();

    expect(data).toEqual({ format: 'CD', label: 'XL Recordings', track_count: 2 });
  });

  it('sums track_count across media rather than reading it off the release', async () => {
    await ingestReleaseGroupPayload(multiDiscAlbum, admin, detailFetcher(multiDiscReleaseDetail));

    const { data } = await admin
      .from('releases')
      .select('track_count')
      .eq('mbid', multiDiscReleaseDetail.id)
      .single();

    // Two media of one track each. Reading a top-level track-count would give
    // null, which is exactly the bug real data exposed.
    expect(data?.track_count).toBe(2);
  });

  it('keeps multi-disc positions distinct', async () => {
    await ingestReleaseGroupPayload(multiDiscAlbum, admin, detailFetcher(multiDiscReleaseDetail));

    const { data } = await admin
      .from('tracks')
      .select('medium_position, position')
      .order('medium_position');

    expect(data).toEqual([
      { medium_position: 1, position: 1 },
      { medium_position: 2, position: 1 },
    ]);
  });

  it('ingests an album whose release has no tracklist', async () => {
    const result = await ingestReleaseGroupPayload(
      yearOnlyAlbum,
      admin,
      detailFetcher(emptyReleaseDetail),
    );

    // A missing tracklist must not fail the album; the page renders without it.
    expect(result.status).toBe('ingested');
    const { count } = await admin.from('tracks').select('id', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  it('ingests successfully when the detail fetch fails entirely', async () => {
    const result = await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => null);

    expect(result.status).toBe('ingested');
    const { data } = await admin
      .from('albums')
      .select('representative_release_id')
      .eq('mbid', singleArtistAlbum.id)
      .single();
    expect(data?.representative_release_id).not.toBeNull();
  });

  it('does not fetch a tracklist when there is no representative release', async () => {
    let called = false;
    await ingestReleaseGroupPayload(variousArtistsCompilation, admin, async (mbid) => {
      called = true;
      void mbid;
      return null;
    });

    // No releases means no representative release, so no second request is
    // spent against the rate limit.
    expect(called).toBe(false);
  });
});
