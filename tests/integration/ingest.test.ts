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
import {
  findHeldAlbum,
  ingestReleaseGroupPayload,
  reconcileCredits,
} from '@/services/catalogue/ingest';
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
    return detail
      ? ({ status: 'fetched', detail: mapReleaseDetail(detail) } as const)
      : ({ status: 'failed', reason: `no fixture for ${mbid}` } as const);
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
    const result = await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => ({
      status: 'failed',
      reason: 'MusicBrainz returned 503',
    }));

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
      return { status: 'failed', reason: 'should not be called' };
    });

    // No releases means no representative release, so no second request is
    // spent against the rate limit.
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Credit reconciliation
// ---------------------------------------------------------------------------

/**
 * Repairing an album whose row was written without its credits.
 *
 * **The damaged state is produced by damaging a real album, never by inventing
 * one.** `current-state.md` §8 records the standing rule that integration tests
 * do not manufacture catalogue records; ingesting normally and then deleting
 * the `album_artists` rows reproduces the exact production shape — a real album
 * row, a real stored payload, and no credits — without adding a synthetic one.
 */

async function creditsFor(mbid: string) {
  const { data } = await admin
    .from('albums')
    .select('album_artists(position, artists(name))')
    .eq('mbid', mbid)
    .single();

  return (data?.album_artists ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ position: row.position, name: row.artists?.name }));
}

async function stripCredits(mbid: string) {
  const held = await findHeldAlbum(admin, mbid);
  await admin.from('album_artists').delete().eq('album_id', held!.id);
  return held!.id;
}

describe('credit reconciliation', () => {
  it('repairs an album that holds no credits', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    const albumId = await stripCredits(singleArtistAlbum.id);

    expect(await creditsFor(singleArtistAlbum.id)).toEqual([]);

    const outcome = await reconcileCredits(admin, albumId, singleArtistAlbum.id);

    expect(outcome).toEqual({ status: 'reconciled', credits: 1 });
    expect(await creditsFor(singleArtistAlbum.id)).toEqual([{ position: 0, name: 'Radiohead' }]);
  });

  it('repairs to the correct artists, not merely to some artist', async () => {
    await ingestReleaseGroupPayload(collaborationAlbum, admin);
    const albumId = await stripCredits(collaborationAlbum.id);

    await reconcileCredits(admin, albumId, collaborationAlbum.id);

    // Identity, never a count. A count-only assertion passes just as happily
    // with the wrong artist linked, which is the failure this whole cycle is
    // about — an album reachable from nobody, or from the wrong page.
    expect(await creditsFor(collaborationAlbum.id)).toEqual([
      { position: 0, name: 'JAY-Z' },
      { position: 1, name: 'Kanye West' },
    ]);
  });

  it('preserves credit position, rather than renumbering', async () => {
    await ingestReleaseGroupPayload(collaborationAlbum, admin);
    const before = await creditsFor(collaborationAlbum.id);
    const albumId = await stripCredits(collaborationAlbum.id);

    await reconcileCredits(admin, albumId, collaborationAlbum.id);

    expect(await creditsFor(collaborationAlbum.id)).toEqual(before);
  });

  it('is idempotent — reconciling twice changes nothing the second time', async () => {
    await ingestReleaseGroupPayload(collaborationAlbum, admin);
    const albumId = await stripCredits(collaborationAlbum.id);

    const first = await reconcileCredits(admin, albumId, collaborationAlbum.id);
    const after = await creditsFor(collaborationAlbum.id);
    const second = await reconcileCredits(admin, albumId, collaborationAlbum.id);

    expect(first).toEqual(second);
    expect(await creditsFor(collaborationAlbum.id)).toEqual(after);

    const { count } = await admin
      .from('album_artists')
      .select('artist_id', { count: 'exact', head: true });
    expect(count).toBe(2);
  });

  it('reports no_payload rather than throwing, and writes nothing', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    const albumId = await stripCredits(singleArtistAlbum.id);

    // The structurally unreachable case, forced: a held album with no snapshot.
    await admin
      .from('upstream_payloads')
      .delete()
      .eq('source_id', singleArtistAlbum.id)
      .eq('kind', 'release_group');

    const outcome = await reconcileCredits(admin, albumId, singleArtistAlbum.id);

    // Not 'reconciled'. An album that could not be repaired must never be
    // counted among those that were.
    expect(outcome).toEqual({ status: 'no_payload' });
    expect(await creditsFor(singleArtistAlbum.id)).toEqual([]);
  });

  it('leaves a complete album entirely alone — no album or payload write', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);

    const stamps = async () => {
      const { data: album } = await admin
        .from('albums')
        .select('updated_at')
        .eq('mbid', singleArtistAlbum.id)
        .single();
      const { data: payload } = await admin
        .from('upstream_payloads')
        .select('fetched_at')
        .eq('source_id', singleArtistAlbum.id)
        .eq('kind', 'release_group')
        .single();
      return { album: album!.updated_at, payload: payload!.fetched_at };
    };

    const before = await stamps();

    // The caller's gate, exercised exactly as the three callers apply it.
    const held = await findHeldAlbum(admin, singleArtistAlbum.id);
    expect(held!.hasCredits).toBe(true);
    if (!held!.hasCredits) await reconcileCredits(admin, held!.id, singleArtistAlbum.id);

    // `fetched_at` is the sharper of the two. Reusing the full ingest path to
    // repair would re-store a payload read from disk and move this stamp,
    // making the snapshot lie about when it was taken.
    expect(await stamps()).toEqual(before);
  });

  it('finds a held album and reports whether it carries credits', async () => {
    expect(await findHeldAlbum(admin, singleArtistAlbum.id)).toBeNull();

    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    expect((await findHeldAlbum(admin, singleArtistAlbum.id))?.hasCredits).toBe(true);

    await stripCredits(singleArtistAlbum.id);
    expect((await findHeldAlbum(admin, singleArtistAlbum.id))?.hasCredits).toBe(false);
  });
});

describe('credit write ordering', () => {
  /**
   * A client whose `album_artists` delete fails, and whose every other call is
   * the real thing.
   *
   * This exists because the ordering is invisible on the success path: both
   * orders leave identical rows, so the only way to test it is to interrupt
   * between the two statements. It is coupled to the exact `.delete().eq().not()`
   * chain `replaceCredits` issues — deliberately, since pinning that ordering is
   * the entire purpose.
   */
  function clientWithFailingCreditDelete() {
    return new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== 'from') return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const builder = target.from(table as 'album_artists');
          if (table !== 'album_artists') return builder;
          return new Proxy(builder, {
            get(b, p, r) {
              if (p !== 'delete') return Reflect.get(b, p, r);
              return () => ({
                eq: () => ({
                  not: async () => ({ error: new Error('simulated interruption') }),
                }),
              });
            },
          });
        };
      },
    }) as typeof admin;
  }

  it('an upstream-added credit survives an interruption before the delete', async () => {
    // Held with one credit, then upstream adds a second.
    const reduced = {
      ...collaborationAlbum,
      'artist-credit': [collaborationAlbum['artist-credit']![0]],
    };
    await ingestReleaseGroupPayload(reduced, admin);
    expect(await creditsFor(collaborationAlbum.id)).toEqual([{ position: 0, name: 'JAY-Z' }]);

    await expect(
      ingestReleaseGroupPayload(collaborationAlbum, clientWithFailingCreditDelete()),
    ).rejects.toThrow('simulated interruption');

    // Under upsert-then-delete the credits are already committed when the
    // delete fails, so the album is complete. Under delete-then-upsert the
    // throw precedes the upsert and the album keeps only JAY-Z — present,
    // credited, and missing the artist that was just added.
    expect(await creditsFor(collaborationAlbum.id)).toEqual([
      { position: 0, name: 'JAY-Z' },
      { position: 1, name: 'Kanye West' },
    ]);
  });
});
