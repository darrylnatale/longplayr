import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import {
  messyReleaseGroup,
  singleArtistAlbum,
  singleDiscReleaseDetail,
} from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import { drainJobs, enqueueMissingTracklists } from '@/services/catalogue/jobs';
import { mapReleaseDetail } from '@/services/catalogue/map';
import * as tracklist from '@/services/catalogue/tracklist';
import { tracklistCoverage } from '@/services/catalogue/tracklist';

/**
 * Tracklist lifecycle against the real database.
 *
 * The bug this covers was not a missing feature. Ingestion caught the
 * representative-release failure and returned null, the album was written, and
 * nothing recorded that a tracklist had been attempted — so 44 of 335 staging
 * albums had no tracks and nothing pointed at them. A trackless album was
 * indistinguishable from one nobody had looked at.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ALBUM_MBID = singleArtistAlbum.id;
const RELEASE_MBID = singleDiscReleaseDetail.id;

const fetched = () =>
  ({ status: 'fetched', detail: mapReleaseDetail(singleDiscReleaseDetail) }) as const;
const failed = (reason = 'MusicBrainz returned 503') => ({ status: 'failed', reason }) as const;

async function clear() {
  await admin.from('ingestion_jobs').delete().gte('id', 0);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(clear);
afterEach(() => vi.restoreAllMocks());
afterAll(clear);

async function releaseState(mbid = RELEASE_MBID) {
  const { data } = await admin
    .from('releases')
    .select('id, tracklist_status, tracklist_updated_at')
    .eq('mbid', mbid)
    .single();
  return data;
}

async function trackCount(mbid = RELEASE_MBID) {
  const release = await releaseState(mbid);
  const { count } = await admin
    .from('tracks')
    .select('id', { count: 'exact', head: true })
    .eq('release_id', release!.id);
  return count ?? 0;
}

async function tracklistJob() {
  const { data } = await admin
    .from('ingestion_jobs')
    .select('status, attempts, last_error, target_mbid')
    .eq('kind', 'fetch_tracklist')
    .maybeSingle();
  return data;
}

/** Clears a job's backoff so the next drain can claim it. */
async function clearBackoff() {
  await admin
    .from('ingestion_jobs')
    .update({ run_after: new Date(Date.now() - 60_000).toISOString() })
    .gte('id', 0);
}

describe('tracklist outcome is recorded during ingest', () => {
  it('records found and stores the tracks', async () => {
    const result = await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => fetched());

    expect(result.status).toBe('ingested');
    expect(result.status === 'ingested' && result.tracklist).toMatchObject({ status: 'found' });
    expect((await releaseState())?.tracklist_status).toBe('found');
    expect(await trackCount()).toBeGreaterThan(0);
  });

  it('records absent when MusicBrainz answers with no tracks', async () => {
    const empty = { ...mapReleaseDetail(singleDiscReleaseDetail), tracks: [] };
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => ({
      status: 'fetched',
      detail: empty,
    }));

    // An answer, not a failure: nothing to retry.
    expect((await releaseState())?.tracklist_status).toBe('absent');
    expect(await tracklistJob()).toBeNull();
  });

  it('records failed and queues a retry when the fetch errors', async () => {
    const result = await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => failed());

    // The album survives — that principle is unchanged.
    expect(result.status).toBe('ingested');
    const { data: album } = await admin
      .from('albums')
      .select('representative_release_id')
      .eq('mbid', ALBUM_MBID)
      .single();
    expect(album?.representative_release_id).not.toBeNull();

    // But the failure is now visible and actionable, which is the whole point.
    expect((await releaseState())?.tracklist_status).toBe('failed');
    expect(await tracklistJob()).toMatchObject({
      status: 'pending',
      target_mbid: RELEASE_MBID,
    });
  });

  it('never reports a failed fetch as an ingested album with a settled tracklist', async () => {
    const result = await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => failed());

    const settled = ['found', 'absent'];
    expect(result.status === 'ingested' && settled).not.toContain(
      result.status === 'ingested' ? result.tracklist?.status : undefined,
    );
    expect(await trackCount()).toBe(0);
  });
});

describe('fetch_tracklist job lifecycle', () => {
  beforeEach(async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => failed());
  });

  it('returns the job to pending when the fetch fails again', async () => {
    vi.spyOn(tracklist, 'fetchAndStoreTracklist').mockResolvedValue({
      status: 'failed',
      reason: 'MusicBrainz returned 503',
    });

    const summary = await drainJobs(10, admin);

    expect(summary).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    const job = await tracklistJob();
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job?.last_error).toContain('503');
  });

  it('completes on a later attempt and settles as found', async () => {
    vi.spyOn(tracklist, 'fetchAndStoreTracklist').mockResolvedValue({
      status: 'failed',
      reason: 'still down',
    });
    await drainJobs(10, admin);
    expect((await tracklistJob())?.status).toBe('pending');

    vi.restoreAllMocks();
    vi.spyOn(tracklist, 'fetchAndStoreTracklist').mockImplementation(async (mbid, client) => {
      const release = await releaseState(mbid as string);
      await tracklist.storeTracklist(
        (client ?? admin) as SupabaseClient<Database>,
        release!.id,
        mapReleaseDetail(singleDiscReleaseDetail),
      );
      return { status: 'found', trackCount: 2 };
    });

    await clearBackoff();
    await drainJobs(10, admin);

    expect((await tracklistJob())?.status).toBe('succeeded');
    expect((await releaseState())?.tracklist_status).toBe('found');
    expect(await trackCount()).toBeGreaterThan(0);
  });

  it('does not retry an absent tracklist — MusicBrainz answered', async () => {
    vi.spyOn(tracklist, 'fetchAndStoreTracklist').mockResolvedValue({
      status: 'absent',
      reason: 'MusicBrainz holds no tracks for this release',
    });

    const summary = await drainJobs(10, admin);

    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    expect((await tracklistJob())?.status).toBe('succeeded');
  });

  it('exhausts after max_attempts and stays observable', async () => {
    vi.spyOn(tracklist, 'fetchAndStoreTracklist').mockResolvedValue({
      status: 'failed',
      reason: 'MusicBrainz returned 503',
    });

    for (let i = 0; i < 3; i++) {
      await clearBackoff();
      await drainJobs(10, admin);
    }

    // Stops on its own, and says so — not silence.
    const job = await tracklistJob();
    expect(job).toMatchObject({ status: 'failed', attempts: 3 });
    expect(job?.last_error).toContain('503');
    expect((await releaseState())?.tracklist_status).toBe('failed');
  });
});

describe('enqueueMissingTracklists', () => {
  it('queues a representative release left pending', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    expect((await releaseState())?.tracklist_status).toBe('pending');

    const result = await enqueueMissingTracklists({ admin });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
    expect((await tracklistJob())?.target_mbid).toBe(RELEASE_MBID);
  });

  it('queues a representative release whose retries were exhausted', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => failed());
    await admin.from('ingestion_jobs').delete().gte('id', 0);

    const result = await enqueueMissingTracklists({ admin });
    expect(result).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('leaves settled releases alone', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => fetched());

    expect(await enqueueMissingTracklists({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('ignores non-representative releases, which are pending by design', async () => {
    // Three releases, only one of which becomes representative and is given a
    // tracklist. The other two stay pending forever, correctly.
    await ingestReleaseGroupPayload(messyReleaseGroup, admin, async () => fetched());

    const { count: pendingReleases } = await admin
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .eq('tracklist_status', 'pending');
    expect(pendingReleases ?? 0).toBe(2);

    // Sweeping by status alone would have queued both. On staging that is the
    // difference between 44 jobs and 6,072.
    expect(await enqueueMissingTracklists({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('is idempotent — a second sweep queues nothing new', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);

    const first = await enqueueMissingTracklists({ admin });
    const second = await enqueueMissingTracklists({ admin });

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(0);
    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'fetch_tracklist');
    expect(count).toBe(1);
  });

  it('sweeps, drains, and finds nothing left to do', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    vi.spyOn(tracklist, 'fetchAndStoreTracklist').mockImplementation(async (mbid, client) => {
      const release = await releaseState(mbid as string);
      await tracklist.storeTracklist(
        (client ?? admin) as SupabaseClient<Database>,
        release!.id,
        mapReleaseDetail(singleDiscReleaseDetail),
      );
      return { status: 'found', trackCount: 2 };
    });

    await enqueueMissingTracklists({ admin });
    await drainJobs(10, admin);

    expect((await releaseState())?.tracklist_status).toBe('found');
    expect(await enqueueMissingTracklists({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });
});

describe('tracklistCoverage', () => {
  it('counts representative releases only, and hides no failures', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => failed());

    const coverage = await tracklistCoverage(admin);

    expect(coverage).toMatchObject({ found: 0, absent: 0, failed: 1, pending: 0, total: 1 });
    // 0 of 1 attempted. A metric that excluded failures would say 0/0 and print
    // a reassuring nothing.
    expect(coverage.observedCoveragePercent).toBe(0);
  });

  it('reports full coverage once the tracklist arrives', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin, async () => fetched());

    expect(await tracklistCoverage(admin)).toMatchObject({
      found: 1,
      failed: 0,
      observedCoveragePercent: 100,
    });
  });
});
