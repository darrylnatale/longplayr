import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { singleArtistAlbum, yearOnlyAlbum } from '@/services/catalogue/fixtures';
import {
  drainJobs,
  enqueueJob,
  enqueueMissingArtwork,
  queueDepth,
} from '@/services/catalogue/jobs';
import * as ingest from '@/services/catalogue/ingest';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';
import * as artwork from '@/services/catalogue/artwork';
import { ARTWORK_BUCKET } from '@/services/catalogue/artwork';

/**
 * Job queue against the real database.
 *
 * The work each job performs is stubbed at the service boundary; what is under
 * test here is the queue itself — claiming, retry, backoff, exhaustion and the
 * partial unique index.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const MBID_A = singleArtistAlbum.id;
const MBID_B = '0b0e4f1e-1111-4000-8000-0000000000bb';

async function clear() {
  await admin.from('ingestion_jobs').delete().gte('id', 0);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(clear);
afterEach(() => vi.restoreAllMocks());
afterAll(clear);

/** Succeeds without touching MusicBrainz. */
function stubIngestSuccess() {
  vi.spyOn(ingest, 'ingestReleaseGroup').mockResolvedValue({
    status: 'ingested',
    albumId: 'stub',
    mbid: MBID_A,
  });
  vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({ status: 'found', sizes: [500] });
}

describe('enqueueJob', () => {
  it('queues a job as pending', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const { data } = await admin.from('ingestion_jobs').select('*').single();
    expect(data).toMatchObject({ status: 'pending', attempts: 0, kind: 'ingest_release_group' });
  });

  it('ignores a duplicate for the same kind and target', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(1);
  });

  it('allows different kinds for the same target', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(2);
  });

  it('allows re-queueing once the earlier job has completed', async () => {
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await admin.from('ingestion_jobs').update({ status: 'succeeded' }).gte('id', 0);

    // The unique index is partial on pending/running, so a later re-sync is
    // not blocked by history.
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(2);
  });
});

describe('drainJobs', () => {
  it('runs a queued job and marks it succeeded', async () => {
    stubIngestSuccess();
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect(await queueDepth(admin)).toMatchObject({ succeeded: 1, pending: 1 });
  });

  it('queues artwork as a follow-up job after a successful ingest', async () => {
    stubIngestSuccess();
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await drainJobs(10, admin);

    // Separate job so a Cover Art Archive failure cannot fail metadata that
    // already succeeded.
    const { data } = await admin
      .from('ingestion_jobs')
      .select('kind, status')
      .eq('kind', 'fetch_artwork')
      .single();
    expect(data).toMatchObject({ kind: 'fetch_artwork', status: 'pending' });
  });

  it('treats an out-of-scope release group as success, with no artwork follow-up', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockResolvedValue({
      status: 'out_of_scope',
      mbid: MBID_A,
      reason: 'primary type "single" is out of scope',
    });
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    // Refusing a single is the system working, not a failure to retry.
    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'fetch_artwork');
    expect(count).toBe(0);
  });

  it('returns a failed job to pending with a future run_after', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('upstream exploded'));
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    const summary = await drainJobs(10, admin);
    expect(summary).toMatchObject({ failed: 1, exhausted: 0 });

    const { data } = await admin.from('ingestion_jobs').select('*').single();
    expect(data?.status).toBe('pending');
    expect(data?.attempts).toBe(1);
    expect(data?.last_error).toContain('upstream exploded');
    expect(new Date(data!.run_after).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not claim a job whose backoff has not elapsed', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('nope'));
    await enqueueJob('ingest_release_group', MBID_A, { admin });
    await drainJobs(10, admin);

    const second = await drainJobs(10, admin);
    expect(second.claimed).toBe(0);
  });

  it('gives up after max_attempts and marks the job failed', async () => {
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('always fails'));
    await enqueueJob('ingest_release_group', MBID_A, { admin });

    // Three attempts, clearing the backoff between each.
    //
    // Backdated by a minute rather than set to "now": the app and the database
    // run on different clocks, and skew of a few milliseconds is enough to make
    // `run_after <= now()` false and the job unclaimable. That made this test
    // flaky roughly one run in three.
    for (let i = 0; i < 3; i++) {
      await admin
        .from('ingestion_jobs')
        .update({ run_after: new Date(Date.now() - 60_000).toISOString() })
        .gte('id', 0);
      await drainJobs(10, admin);
    }

    const { data } = await admin.from('ingestion_jobs').select('status, attempts').single();
    expect(data).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('respects priority order', async () => {
    stubIngestSuccess();
    await enqueueJob('fetch_artwork', MBID_B, { admin, priority: 200 });
    await enqueueJob('fetch_artwork', MBID_A, { admin, priority: 1 });

    await drainJobs(1, admin);

    const { data } = await admin
      .from('ingestion_jobs')
      .select('target_mbid, status')
      .eq('status', 'succeeded');
    expect(data).toHaveLength(1);
    expect(data?.[0].target_mbid).toBe(MBID_A);
  });

  it('claims nothing when the queue is empty', async () => {
    expect(await drainJobs(10, admin)).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
      exhausted: 0,
    });
  });

  it('does not hand the same job to two concurrent drains', async () => {
    stubIngestSuccess();
    for (let i = 0; i < 6; i++) {
      await enqueueJob('fetch_artwork', `0b0e4f1e-1111-4000-8000-00000000c0${i}0`, { admin });
    }

    // Duplicated work here means wasted requests against a one-per-second
    // budget, so `for update skip locked` has to hold under concurrency.
    const [first, second] = await Promise.all([drainJobs(6, admin), drainJobs(6, admin)]);

    expect(first.claimed + second.claimed).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Artwork lifecycle
//
// The seed left 36 albums at artwork_status 'pending' with no job queued and
// nothing scheduled to notice. The cause was subtler than a missing feature:
// fetchAndStoreArtwork records its outcome and returns rather than throwing —
// correct, so a Cover Art Archive problem cannot fail a metadata ingest that
// succeeded — but the job runner ignored the returned status, so a failed fetch
// marked the job 'succeeded' and no retry was ever scheduled.
//
// These cover the whole path: failure, retry, and settling as found or absent.
// ---------------------------------------------------------------------------

/** Clears a job's backoff so the next drain can claim it. */
async function clearBackoff() {
  // Backdated rather than set to now: app and database clocks differ by enough
  // to make `run_after <= now()` false, which made an earlier test flaky.
  await admin
    .from('ingestion_jobs')
    .update({ run_after: new Date(Date.now() - 60_000).toISOString() })
    .gte('id', 0);
}

async function artworkStatusOf(mbid: string) {
  const { data } = await admin.from('albums').select('artwork_status').eq('mbid', mbid).single();
  return data?.artwork_status;
}

async function artworkJob() {
  const { data } = await admin
    .from('ingestion_jobs')
    .select('status, attempts, last_error')
    .eq('kind', 'fetch_artwork')
    .single();
  return data;
}

describe('artwork job failure and retry', () => {
  it('returns the job to pending when the fetch fails, rather than marking it succeeded', async () => {
    // The exact regression. fetchAndStoreArtwork returns 'failed' without
    // throwing; the runner used to discard that and call the job a success.
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'failed',
      reason: 'Cover Art Archive returned 500 for abc (250)',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    expect(summary).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    const job = await artworkJob();
    expect(job).toMatchObject({ status: 'pending', attempts: 1 });
    expect(job?.last_error).toContain('Cover Art Archive returned 500');
  });

  it('schedules the retry into the future rather than immediately', async () => {
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'failed',
      reason: 'transient',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });
    await drainJobs(10, admin);

    const { data } = await admin.from('ingestion_jobs').select('run_after').single();
    expect(new Date(data!.run_after).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not retry an absent cover — Cover Art Archive answered', async () => {
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'absent',
      reason: 'Cover Art Archive holds no front cover',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    const summary = await drainJobs(10, admin);

    // Absence is a settled fact about the artwork, not a failure to reach it.
    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
    expect((await artworkJob())?.status).toBe('succeeded');
  });

  it('gives up after max_attempts and leaves the job failed', async () => {
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockResolvedValue({
      status: 'failed',
      reason: 'Cover Art Archive returned 500',
    });
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    for (let i = 0; i < 3; i++) {
      await clearBackoff();
      await drainJobs(10, admin);
    }

    // Exhaustion is surfaced, not silent: the job stops on its own and a
    // recovery sweep is a deliberate act.
    expect(await artworkJob()).toMatchObject({ status: 'failed', attempts: 3 });
  });
});

describe('artwork lifecycle end to end', () => {
  /**
   * Intercepts Cover Art Archive only. supabase-js talks to the database over
   * fetch too, so a blanket stub breaks every query in the test.
   */
  function stubCoverArt(behaviour: () => Response) {
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('coverartarchive.org')) return behaviour();
      return realFetch(input as RequestInfo, init);
    });
  }

  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
  const serverError = () => new Response('upstream error', { status: 500 });
  const image = () =>
    new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  const noCover = () => new Response(null, { status: 404 });

  afterEach(async () => {
    const { data } = await admin.storage.from(ARTWORK_BUCKET).list();
    for (const entry of data ?? []) {
      const { data: inner } = await admin.storage.from(ARTWORK_BUCKET).list(entry.name);
      await admin.storage
        .from(ARTWORK_BUCKET)
        .remove((inner ?? []).map((f) => `${entry.name}/${f.name}`));
    }
  });

  it('moves failed → retry → found, with the album and the job agreeing', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    // Attempt one: Cover Art Archive is down.
    stubCoverArt(serverError);
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('failed');
    expect((await artworkJob())?.status).toBe('pending');

    // Attempt two: it recovers.
    vi.restoreAllMocks();
    stubCoverArt(image);
    await clearBackoff();
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('found');
    expect((await artworkJob())?.status).toBe('succeeded');
  });

  it('moves failed → retry → absent when the recovered service holds no cover', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });

    stubCoverArt(serverError);
    await drainJobs(10, admin);
    expect(await artworkStatusOf(MBID_A)).toBe('failed');

    vi.restoreAllMocks();
    stubCoverArt(noCover);
    await clearBackoff();
    await drainJobs(10, admin);

    // A failure that resolves to absence is still a resolution. What must never
    // happen is the reverse: absence recorded while the service was unreachable.
    expect(await artworkStatusOf(MBID_A)).toBe('absent');
    expect((await artworkJob())?.status).toBe('succeeded');
  });

  it('is idempotent — draining the same album twice changes nothing', async () => {
    await ingestReleaseGroupPayload(singleArtistAlbum, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });
    stubCoverArt(image);

    await drainJobs(10, admin);
    await enqueueJob('fetch_artwork', MBID_A, { admin });
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('found');
    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'fetch_artwork')
      .eq('status', 'succeeded');
    expect(count).toBe(2);
  });
});

describe('enqueueMissingArtwork', () => {
  async function albumWithStatus(
    payload: typeof singleArtistAlbum,
    status: Database['public']['Enums']['artwork_status'],
  ) {
    await ingestReleaseGroupPayload(payload, admin);
    await admin.from('albums').update({ artwork_status: status }).eq('mbid', payload.id);
  }

  it('queues the legacy pending rows the seed left behind', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');

    const result = await enqueueMissingArtwork({ admin });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
    expect((await artworkJob())?.status).toBe('pending');
  });

  it('queues albums whose retries were exhausted', async () => {
    await albumWithStatus(singleArtistAlbum, 'failed');

    const result = await enqueueMissingArtwork({ admin });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('leaves settled albums alone', async () => {
    await albumWithStatus(singleArtistAlbum, 'found');
    await albumWithStatus(yearOnlyAlbum, 'absent');

    const result = await enqueueMissingArtwork({ admin });

    // Re-fetching a cover we already have, or re-asking a question already
    // answered, spends requests for nothing.
    expect(result).toMatchObject({ candidates: 0, queued: 0 });
  });

  it('is idempotent — a second sweep queues nothing new', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');

    const first = await enqueueMissingArtwork({ admin });
    const second = await enqueueMissingArtwork({ admin });

    expect(first.queued).toBe(1);
    // The partial unique index makes the duplicate a no-op rather than an error.
    expect(second.queued).toBe(0);

    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'fetch_artwork');
    expect(count).toBe(1);
  });

  it('respects the limit, so a daily drain is not buried', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');
    await albumWithStatus(yearOnlyAlbum, 'pending');

    const result = await enqueueMissingArtwork({ admin, limit: 1 });

    expect(result).toMatchObject({ candidates: 1, queued: 1 });
  });

  it('sweeps and then drains to completion', async () => {
    await albumWithStatus(singleArtistAlbum, 'pending');
    vi.spyOn(artwork, 'fetchAndStoreArtwork').mockImplementation(async (mbid, client) => {
      await (client ?? admin)
        .from('albums')
        .update({ artwork_status: 'found' })
        .eq('mbid', mbid as string);
      return { status: 'found', sizes: [500] };
    });

    await enqueueMissingArtwork({ admin });
    await drainJobs(10, admin);

    expect(await artworkStatusOf(MBID_A)).toBe('found');
    // Nothing left to do, which is what recovery finishing looks like.
    expect(await enqueueMissingArtwork({ admin })).toMatchObject({ candidates: 0, queued: 0 });
  });
});
