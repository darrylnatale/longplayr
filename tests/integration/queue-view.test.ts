import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { inspectQueue, stateFor } from '@/services/catalogue/queue-view';

/**
 * The read behind the temporary operator surface. `architecture.md` §17a.
 *
 * **The property that matters most is what this does _not_ do**: it must never
 * claim. A diagnostic that spent a job's attempts because somebody opened a page
 * would be worse than no diagnostic, and the ordering it mirrors is the claim's,
 * so the mistake is one line away.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const MBID = (n: number) => `0b0e4f1e-1111-4000-8000-0000000f00${String(n).padStart(2, '0')}`;

async function clear() {
  await admin
    .from('ingestion_jobs')
    .delete()
    .neq('target_mbid', '00000000-0000-0000-0000-000000000000');
}

async function seed(row: {
  mbid: string;
  status: Database['public']['Enums']['job_status'];
  priority?: number;
  attempts?: number;
  runAfterMs?: number;
  lastError?: string;
}) {
  const { error } = await admin.from('ingestion_jobs').insert({
    kind: 'fetch_artwork',
    target_mbid: row.mbid,
    status: row.status,
    priority: row.priority ?? 100,
    attempts: row.attempts ?? 0,
    run_after: new Date(Date.now() + (row.runAfterMs ?? -60_000)).toISOString(),
    last_error: row.lastError ?? null,
  });
  if (error) throw error;
}

beforeEach(clear);
afterAll(clear);

describe('stateFor', () => {
  const base = {
    id: 1,
    kind: 'fetch_artwork' as const,
    target_mbid: MBID(1),
    priority: 100,
    attempts: 0,
    last_error: null,
    created_at: '',
    updated_at: '',
  };
  const now = new Date('2026-09-13T12:00:00Z');

  it('calls a future run_after backing off, which is the distinction the raw row hides', () => {
    const job = { ...base, status: 'pending' as const, run_after: '2026-09-13T12:30:00Z' };
    expect(stateFor(job as never, now, false)).toBe('backing off');
  });

  it('calls a past run_after waiting for a drain', () => {
    const job = { ...base, status: 'pending' as const, run_after: '2026-09-13T11:00:00Z' };
    expect(stateFor(job as never, now, false)).toBe('waiting for a drain');
  });

  it('names the head of the queue specifically', () => {
    const job = { ...base, status: 'pending' as const, run_after: '2026-09-13T11:00:00Z' };
    expect(stateFor(job as never, now, true)).toBe('next to be claimed');
  });

  it('distinguishes running and terminally failed', () => {
    const run_after = '2026-09-13T11:00:00Z';
    expect(stateFor({ ...base, status: 'running', run_after } as never, now, false)).toBe(
      'running now',
    );
    expect(stateFor({ ...base, status: 'failed', run_after } as never, now, false)).toBe(
      'terminally failed — awaiting the sweep',
    );
  });
});

describe('inspectQueue', () => {
  it('orders the ready queue the way a drain would claim it', async () => {
    await seed({ mbid: MBID(1), status: 'pending', priority: 200 });
    await seed({ mbid: MBID(2), status: 'pending', priority: 100 });
    await seed({ mbid: MBID(3), status: 'pending', priority: 100 });

    const snapshot = await inspectQueue({ admin });

    // priority asc, then id asc — so the second-inserted 100 precedes the third.
    expect(snapshot.next.map((job) => job.target_mbid)).toEqual([MBID(2), MBID(3), MBID(1)]);
    expect(snapshot.next[0].state).toBe('next to be claimed');
    expect(snapshot.next[1].state).toBe('waiting for a drain');
  });

  it('claims nothing — every row keeps its status and its attempts', async () => {
    // The property this file exists for.
    await seed({ mbid: MBID(4), status: 'pending', attempts: 1 });

    await inspectQueue({ admin });
    await inspectQueue({ admin });

    const { data } = await admin
      .from('ingestion_jobs')
      .select('status, attempts')
      .eq('target_mbid', MBID(4))
      .single();
    expect(data).toMatchObject({ status: 'pending', attempts: 1 });
  });

  it('separates backing off from ready, and surfaces when it becomes claimable', async () => {
    await seed({ mbid: MBID(5), status: 'pending', runAfterMs: 30 * 60_000, attempts: 2 });

    const snapshot = await inspectQueue({ admin });

    expect(snapshot.next).toHaveLength(0);
    expect(snapshot.backingOff.map((job) => job.target_mbid)).toEqual([MBID(5)]);
    expect(snapshot.backingOff[0].state).toBe('backing off');
    expect(snapshot.backingOff[0].claimableAt).not.toBeNull();
  });

  it('surfaces terminal failures with their error text', async () => {
    await seed({
      mbid: MBID(6),
      status: 'failed',
      attempts: 3,
      lastError: 'MusicBrainz returned 503 for /release-group',
    });

    const snapshot = await inspectQueue({ admin });

    expect(snapshot.failed).toHaveLength(1);
    expect(snapshot.failed[0].last_error).toContain('503');
    expect(snapshot.failed[0].state).toBe('terminally failed — awaiting the sweep');
    // A terminal failure is not offered as work.
    expect(snapshot.next).toHaveLength(0);
  });

  it('counts outstanding work by kind and status, and reports the last activity', async () => {
    await seed({ mbid: MBID(7), status: 'pending' });
    await seed({ mbid: MBID(8), status: 'running' });

    const snapshot = await inspectQueue({ admin });

    expect(snapshot.depthByKind['fetch_artwork · pending']).toBe(1);
    expect(snapshot.depthByKind['fetch_artwork · running']).toBe(1);
    expect(snapshot.running[0].state).toBe('running now');
    expect(snapshot.lastActivityAt).not.toBeNull();
    expect(Object.keys(snapshot.artwork).sort()).toEqual(['absent', 'failed', 'found', 'pending']);
  });
});
