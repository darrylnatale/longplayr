import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { drainJobs } from '@/services/catalogue/jobs';
import { inspectQueue } from '@/services/catalogue/queue-view';

/**
 * At most one drainer — F-028, `architecture.md` §7.3.
 *
 * **What this protects is not throughput, it is the catalogue.** `RateLimiter`
 * is a module-level object, so it serialises within one Node process; on Vercel
 * concurrent requests run in separate lambdas **each with its own limiter**, and
 * MusicBrainz returns `503` for *every* request from the address once the
 * one-per-second budget is passed — not merely the excess.
 *
 * **The condition is routine rather than theoretical.** `drainJobs` is called
 * from four places, two inside `after()` on the album and artist pages, against
 * twelve cron runs a day.
 *
 * **Asserted in both directions.** A lease that never grants would pass every
 * refusal below while stopping ingestion entirely, which is the worse failure.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 30_000 });

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Puts the lease back so one test cannot strand the next. */
async function release() {
  await admin.rpc('release_drain_lease', { p_id: 'ingest' });
}

beforeEach(release);
afterEach(release);

describe('the lease itself', () => {
  it('grants to the first caller and refuses the second', async () => {
    const { data: first } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 75,
    });
    const { data: second } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 75,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('grants again once released', async () => {
    await admin.rpc('try_acquire_drain_lease', { p_id: 'ingest', p_ttl_seconds: 75 });
    await release();

    const { data } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 75,
    });
    expect(data).toBe(true);
  });

  it('grants once the lease has lapsed, with no release at all', async () => {
    // **The crash path, and the reason this is a lease rather than a lock.** A
    // holder that dies never releases; the expiry is what recovers. Taken with
    // a zero TTL so it has already lapsed by the next statement.
    const { data: taken } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 0,
    });
    expect(taken).toBe(true);

    const { data: again } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 75,
    });
    expect(again).toBe(true);
  });

  it('refuses an id that does not exist rather than creating one', async () => {
    const { data } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'not-a-lease',
      p_ttl_seconds: 75,
    });
    expect(data).toBe(false);
  });

  it('is not reachable by a client token', async () => {
    // The privilege half. `authenticated` has no EXECUTE and the table has no
    // grant, so a user token cannot take, release or inspect the lease.
    const asAnon = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error: rpcError } = await asAnon.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 75,
    });
    expect(rpcError).not.toBeNull();

    const { error: readError } = await asAnon.from('drain_leases').select('id');
    expect(readError).not.toBeNull();
  });
});

describe('the drain records what it did — F-033', () => {
  it('writes the outcome and the claimed count on release', async () => {
    // **`lastActivityAt` cannot answer this**, which is the gap being closed: a
    // drain over an empty queue settles no job, so the only trace it leaves is
    // the one written here.
    await drainJobs(1, admin);

    const { data } = await admin
      .from('drain_leases')
      .select('last_outcome, last_outcome_at, last_claimed')
      .eq('id', 'ingest')
      .single();

    expect(data!.last_outcome).toBe('drained');
    expect(data!.last_claimed).toBe(0);
    expect(data!.last_outcome_at).not.toBeNull();
  });

  it('counts a skip without overwriting the last real outcome', async () => {
    // **The two facts must not share a column.** A skip that clobbered the last
    // outcome would destroy the information this cycle adds.
    await drainJobs(1, admin);
    const { data: before } = await admin
      .from('drain_leases')
      .select('last_outcome, skipped_count')
      .eq('id', 'ingest')
      .single();

    await admin.rpc('try_acquire_drain_lease', { p_id: 'ingest', p_ttl_seconds: 75 });
    const skipped = await drainJobs(1, admin);
    expect(skipped.stoppedBecause).toBe('lease_held');

    const { data: after } = await admin
      .from('drain_leases')
      .select('last_outcome, skipped_count')
      .eq('id', 'ingest')
      .single();

    expect(after!.skipped_count).toBe(Number(before!.skipped_count) + 1);
    expect(after!.last_outcome).toBe(before!.last_outcome);
  });

  it('exposes it all through the operator view', async () => {
    await drainJobs(1, admin);

    const snapshot = await inspectQueue({ admin });

    expect(snapshot.lastDrain.outcome).toBe('drained');
    expect(snapshot.lastDrain.ran).toBeGreaterThan(0);
    // Released, so nothing is holding it by the time the view is read.
    expect(snapshot.lastDrain.heldNow).toBe(false);
  });
});

describe('drainJobs under the lease', () => {
  it('drains when it holds the lease', async () => {
    // **The positive direction, and without it every refusal is vacuous.** An
    // empty queue drains to completion, which is the outcome being asserted —
    // that the drain ran at all, not that it found work.
    const summary = await drainJobs(1, admin);
    expect(summary.stoppedBecause).toBe('drained');
  });

  it('stops without claiming when somebody else holds the lease', async () => {
    const { data: held } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 75,
    });
    expect(held).toBe(true);

    const summary = await drainJobs(10, admin);

    expect(summary.stoppedBecause).toBe('lease_held');
    expect(summary.claimed).toBe(0);
    // **Reclaim is skipped too, deliberately.** The holder sweeps; a second
    // process repeating the same UPDATE buys nothing.
    expect(summary.reclaimed).toBe(0);
  });

  it('releases the lease when it finishes, so the next drain is not blocked', async () => {
    await drainJobs(1, admin);

    // The `finally` is what makes this true, and a drain holding its 75-second
    // lease to term would block eleven of twelve cron runs an hour.
    const { data } = await admin.rpc('try_acquire_drain_lease', {
      p_id: 'ingest',
      p_ttl_seconds: 75,
    });
    expect(data).toBe(true);
  });
});
