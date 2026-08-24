import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import type { MbReleaseGroup } from '@/services/catalogue/musicbrainz';

/**
 * Artist-level recovery for the curated tranche.
 *
 * A transient MusicBrainz shed can exhaust the request-level retries for one
 * artist while the rest succeed. The successful work must survive, and the
 * failed artist must remain recoverable after the process exits.
 *
 * **No live MusicBrainz.** The browse is mocked so failure is deterministic;
 * the contact guard is untouched and no request leaves the machine.
 */

const browse = vi.hoisted(() => ({
  failFor: new Set<string>(),
  calls: [] as string[],
  groups: new Map<string, MbReleaseGroup[]>(),
}));

vi.mock('@/services/catalogue/musicbrainz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/catalogue/musicbrainz')>();
  return {
    ...actual,
    browseAllReleaseGroupsByArtist: async (mbid: string) => {
      browse.calls.push(mbid);
      if (browse.failFor.has(mbid)) {
        throw new actual.MusicBrainzError('server busy (simulated edge shed)', 503);
      }
      return { groups: browse.groups.get(mbid) ?? [], requests: 1, truncated: false };
    },
  };
});

const { curatedTrancheStatus, enqueueCuratedTranche } =
  await import('@/services/catalogue/curated-tranche');
const { drainJobs } = await import('@/services/catalogue/jobs');

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ARTIST_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ARTIST_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ARTIST_C = 'cccccccc-0000-4000-8000-000000000003';

const ARTISTS = [
  { name: 'Artist A', mbid: ARTIST_A, method: 'human_verified', confidence: 'high', evidence: 'x' },
  { name: 'Artist B', mbid: ARTIST_B, method: 'human_verified', confidence: 'high', evidence: 'x' },
  { name: 'Artist C', mbid: ARTIST_C, method: 'human_verified', confidence: 'high', evidence: 'x' },
] as const;

const album = (id: string, artistMbid: string, title: string): MbReleaseGroup =>
  ({
    id,
    title,
    'primary-type': 'Album',
    'secondary-types': [],
    'first-release-date': '2001-01-01',
    'artist-credit': [
      { name: title, artist: { id: artistMbid, name: title, 'sort-name': title, type: 'Group' } },
    ],
  }) as MbReleaseGroup;

async function clear() {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin
    .from('ingestion_jobs')
    .delete()
    .neq('target_mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(async () => {
  await clear();
  browse.failFor = new Set();
  browse.calls = [];
  browse.groups = new Map([
    [ARTIST_A, [album('11111111-0000-4000-8000-000000000001', ARTIST_A, 'A One')]],
    [ARTIST_B, [album('22222222-0000-4000-8000-000000000002', ARTIST_B, 'B One')]],
    [ARTIST_C, [album('33333333-0000-4000-8000-000000000003', ARTIST_C, 'C One')]],
  ]);
});
afterAll(clear);

/**
 * Makes every pending job claimable now.
 *
 * `markFailed` pushes a retry behind 30s/5min/30min of real backoff, which is
 * correct behaviour and untestable in-process without saying "later" explicitly.
 */
async function advanceQueue() {
  await admin
    .from('ingestion_jobs')
    .update({ run_after: new Date(Date.now() - 1000).toISOString() })
    .eq('status', 'pending');
}

/** Drains until nothing is claimable, without advancing time. */
async function drainAll(max = 12) {
  for (let i = 0; i < max; i++) {
    const summary = await drainJobs(10, admin);
    if (summary.claimed === 0) return;
  }
}

/** Drains to a terminal state, allowing the backoff to elapse between passes. */
async function drainToTerminal(max = 12) {
  for (let i = 0; i < max; i++) {
    const summary = await drainJobs(10, admin);
    if (summary.claimed === 0) {
      await advanceQueue();
      const retry = await drainJobs(10, admin);
      if (retry.claimed === 0) return;
    }
  }
}

async function albumCount() {
  const { count } = await admin.from('albums').select('mbid', { count: 'exact', head: true });
  return count ?? 0;
}

describe('one artist failing does not discard the others', () => {
  it('ingests the successful artists and leaves the failed one unresolved', async () => {
    browse.failFor = new Set([ARTIST_B]);

    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();

    // A and C are held; B contributed nothing.
    expect(await albumCount()).toBe(2);
    const { data } = await admin.from('albums').select('mbid');
    expect(data!.map((a) => a.mbid).sort()).toEqual([
      '11111111-0000-4000-8000-000000000001',
      '33333333-0000-4000-8000-000000000003',
    ]);
  });

  it('writes no partial albums for the failed artist', async () => {
    browse.failFor = new Set([ARTIST_B]);
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();

    const { count } = await admin
      .from('albums')
      .select('mbid', { count: 'exact', head: true })
      .eq('mbid', '22222222-0000-4000-8000-000000000002');
    expect(count).toBe(0);
  });

  it('reports the run as INCOMPLETE, not successful', async () => {
    browse.failFor = new Set([ARTIST_B]);
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();

    const status = await curatedTrancheStatus({ artists: ARTISTS, admin });
    expect(status.complete).toBe(false);
    expect(status.succeeded).toBe(2);
    expect(status.unresolved.map((u) => u.mbid)).toEqual([ARTIST_B]);
  });

  it('keeps the failed artist durably recoverable in the job table', async () => {
    browse.failFor = new Set([ARTIST_B]);
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();

    // Survives the process exiting: this is a row, not an in-memory list.
    const { data } = await admin
      .from('ingestion_jobs')
      .select('status, attempts, last_error, run_after')
      .eq('kind', 'discover_curated_artist')
      .eq('target_mbid', ARTIST_B)
      .single();

    // Back to pending behind the queue's own backoff, carrying the cause. The
    // row is the durable part: it survives the process exiting, which an
    // in-memory failure list would not.
    expect(data!.status).toBe('pending');
    expect(data!.attempts).toBeGreaterThanOrEqual(1);
    expect(data!.last_error).toContain('server busy');
    expect(new Date(data!.run_after).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('retrying only the unresolved artist', () => {
  it('processes just the failed artist and reaches COMPLETE', async () => {
    browse.failFor = new Set([ARTIST_B]);
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();
    expect((await curatedTrancheStatus({ artists: ARTISTS, admin })).complete).toBe(false);

    // Upstream recovers.
    browse.failFor = new Set();
    browse.calls = [];

    const queued = await enqueueCuratedTranche({ artists: ARTISTS, admin });
    expect(queued.queued).toEqual(['Artist B']);
    expect(queued.alreadyResolved.sort()).toEqual(['Artist A', 'Artist C']);

    // B's existing pending job is behind backoff; the partial unique index
    // means enqueueing again was a no-op rather than a duplicate.
    await advanceQueue();
    await drainAll();

    // Only B was browsed on the retry — A and C are not reprocessed.
    expect(browse.calls).toEqual([ARTIST_B]);

    const status = await curatedTrancheStatus({ artists: ARTISTS, admin });
    expect(status.complete).toBe(true);
    expect(status.succeeded).toBe(3);
    expect(status.unresolved).toEqual([]);
    expect(await albumCount()).toBe(3);
  });

  it('is idempotent — rerunning a resolved tranche does nothing', async () => {
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();
    expect(await albumCount()).toBe(3);

    browse.calls = [];
    const again = await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();

    expect(again.queued).toEqual([]);
    expect(browse.calls).toEqual([]);
    expect(await albumCount()).toBe(3);
  });
});

describe('shared release groups across artists', () => {
  it('does not double-create a release group credited to two curated artists', async () => {
    const shared = album('99999999-0000-4000-8000-000000000009', ARTIST_A, 'Shared');
    browse.groups.set(ARTIST_A, [shared]);
    browse.groups.set(ARTIST_B, [shared]);
    browse.groups.set(ARTIST_C, []);

    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();

    const { count } = await admin
      .from('albums')
      .select('mbid', { count: 'exact', head: true })
      .eq('mbid', shared.id);
    expect(count).toBe(1);
    expect(await albumCount()).toBe(1);
  });

  it('an artist with no in-scope release groups still resolves', async () => {
    // K's case: present in the curated set, contributing no albums.
    browse.groups.set(ARTIST_C, []);
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainAll();

    const status = await curatedTrancheStatus({ artists: ARTISTS, admin });
    expect(status.succeeded).toBe(3);
    expect(status.complete).toBe(true);
  });
});

describe('terminal failure stays recoverable', () => {
  it('exhausts after the queue’s own attempt limit and is reported as such', async () => {
    browse.failFor = new Set([ARTIST_B]);
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainToTerminal();

    const { data } = await admin
      .from('ingestion_jobs')
      .select('status, attempts')
      .eq('kind', 'discover_curated_artist')
      .eq('target_mbid', ARTIST_B)
      .single();
    expect(data!.status).toBe('failed');

    const status = await curatedTrancheStatus({ artists: ARTISTS, admin });
    expect(status.exhausted).toBe(1);
    expect(status.complete).toBe(false);
    expect(status.unresolved[0]).toMatchObject({ mbid: ARTIST_B, state: 'exhausted' });
  });

  it('re-enqueues a terminally failed artist without resetting any status', async () => {
    browse.failFor = new Set([ARTIST_B]);
    await enqueueCuratedTranche({ artists: ARTISTS, admin });
    await drainToTerminal();

    browse.failFor = new Set();
    browse.calls = [];

    // The partial unique index covers pending/running only, so a failed row
    // does not block a fresh job — no status is reset and none is invented.
    const queued = await enqueueCuratedTranche({ artists: ARTISTS, admin });
    expect(queued.queued).toEqual(['Artist B']);

    await drainAll();

    expect(browse.calls).toEqual([ARTIST_B]);
    const status = await curatedTrancheStatus({ artists: ARTISTS, admin });
    expect(status.complete).toBe(true);
    expect(status.succeeded).toBe(3);
    // The old failed row remains alongside the new succeeded one; a succeeded
    // job anywhere resolves the artist.
    const { count } = await admin
      .from('ingestion_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'discover_curated_artist')
      .eq('target_mbid', ARTIST_B);
    expect(count).toBe(2);
  });
});

describe('retry policy opt-in', () => {
  it('the curated path explicitly uses the resilient policy', async () => {
    // Interactive callers must not inherit ~30s waits, so this is asserted at
    // the call site rather than inferred from the default.
    const mb = await import('@/services/catalogue/musicbrainz');
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/services/catalogue/curated-tranche.ts', 'utf8'),
    );
    expect(src).toContain('BACKGROUND_RETRY');
    expect(mb.BACKGROUND_RETRY.maxAttempts).toBe(5);
    expect(mb.BACKGROUND_RETRY.maxDelayMs).toBe(30_000);
    expect(mb.BACKGROUND_RETRY.jitter).toBe(true);
    expect(mb.DEFAULT_RETRY.maxAttempts).toBe(3);
    expect(mb.DEFAULT_RETRY.jitter).toBe(false);
  });
});
