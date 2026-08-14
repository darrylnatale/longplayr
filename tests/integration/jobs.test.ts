import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { singleArtistAlbum } from '@/services/catalogue/fixtures';
import { drainJobs, enqueueJob, queueDepth } from '@/services/catalogue/jobs';
import * as ingest from '@/services/catalogue/ingest';
import * as artwork from '@/services/catalogue/artwork';

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
