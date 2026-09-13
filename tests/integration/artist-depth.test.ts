import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { expansionStateFor, isExcludedFromExpansion } from '@/services/catalogue/artist-depth';
import { attemptStateFor } from '@/services/catalogue/jobs';
import {
  enqueueJob,
  DEFAULT_JOB_PRIORITY,
  INTERACTIVE_JOB_PRIORITY,
} from '@/services/catalogue/queue';

/**
 * On-demand artist depth — the eligibility rule, not the expansion.
 *
 * **What this file deliberately does not test.** `discoverAndIngestArtist`
 * itself is covered in `curated-recovery.test.ts` across fifteen cases —
 * discovery, depth filtering, creation, reconciliation, shared release groups,
 * idempotency and terminal-failure recovery. `enqueueJob`'s duplicate handling
 * is covered in `jobs.test.ts` ("ignores a duplicate for the same kind and
 * target"). Neither is repeated here.
 *
 * **What is new is the decision to ask.** The artist page derives that from job
 * history rather than from a column, because `artists` has none and this slice
 * introduces no migration — so the state machine over `ingestion_jobs` is the
 * thing that had no coverage and now has it.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Distinct from the fixture catalogue, and stable per test by construction. */
function artistMbid(suffix: string): string {
  return `2b3c4d5e-0002-4000-8000-${suffix.padStart(12, '0')}`;
}

const VARIOUS_ARTISTS = '89ad4ac3-39f7-470e-963a-56509c546377';

async function clearJobs() {
  await admin.from('ingestion_jobs').delete().gte('id', 0);
}

/** Writes one job row directly, so a status can be pinned without a drain. */
async function seedJob(targetMbid: string, status: Database['public']['Enums']['job_status']) {
  const { error } = await admin
    .from('ingestion_jobs')
    .insert({ kind: 'discover_curated_artist', target_mbid: targetMbid, status });
  if (error) throw error;
}

beforeEach(clearJobs);
afterAll(clearJobs);

describe('attempt state over job history', () => {
  it('is none when no job has ever existed', async () => {
    const state = await attemptStateFor('discover_curated_artist', artistMbid('a1'), admin);
    expect(state).toBe('none');
  });

  it('is outstanding while a job is pending', async () => {
    const mbid = artistMbid('a2');
    await seedJob(mbid, 'pending');

    expect(await attemptStateFor('discover_curated_artist', mbid, admin)).toBe('outstanding');
  });

  it('is outstanding while a job is running', async () => {
    const mbid = artistMbid('a3');
    await seedJob(mbid, 'running');

    expect(await attemptStateFor('discover_curated_artist', mbid, admin)).toBe('outstanding');
  });

  it('is succeeded once a job has succeeded', async () => {
    const mbid = artistMbid('a4');
    await seedJob(mbid, 'succeeded');

    expect(await attemptStateFor('discover_curated_artist', mbid, admin)).toBe('succeeded');
  });

  it('is failed — distinctly from succeeded — once a job has failed terminally', async () => {
    // **This returned `settled` until 2026-09-13**, collapsing failure into
    // success, which is why the artist page said nothing about an artist whose
    // expansion had terminally failed.
    //
    // **Failure is still not `none`, and that part has not changed.** The queue
    // owns retry — three attempts behind 30s, 5min and 30min — so a row that
    // reached `failed` has already spent it, and reading that as "never
    // attempted" would restart the policy from a page view. The recovery sweep
    // owns the retry instead.
    const mbid = artistMbid('a5');
    await seedJob(mbid, 'failed');

    expect(await attemptStateFor('discover_curated_artist', mbid, admin)).toBe('failed');
  });

  it('is succeeded when one attempt failed and a later one succeeded', async () => {
    // One success is enough. An artist repaired by the sweep is expanded, not
    // failed, and must stop showing a failure line.
    const mbid = artistMbid('a9');
    await seedJob(mbid, 'failed');
    await seedJob(mbid, 'succeeded');

    expect(await attemptStateFor('discover_curated_artist', mbid, admin)).toBe('succeeded');
  });

  it('does not confuse one target with another', async () => {
    // Guards the filter rather than assuming it: a job for a different artist
    // must not make this one look attempted.
    await seedJob(artistMbid('a6'), 'succeeded');

    expect(await attemptStateFor('discover_curated_artist', artistMbid('a7'), admin)).toBe('none');
  });
});

describe('expansion eligibility', () => {
  it('starts an expansion for an artist never attempted', async () => {
    expect(await expansionStateFor(artistMbid('b1'), admin)).toBe('start');
  });

  it('reports outstanding rather than starting a second', async () => {
    const mbid = artistMbid('b2');
    await seedJob(mbid, 'pending');

    expect(await expansionStateFor(mbid, admin)).toBe('outstanding');
  });

  it('is settled once expanded, so an artist is expanded at most once', async () => {
    const mbid = artistMbid('b3');
    await seedJob(mbid, 'succeeded');

    expect(await expansionStateFor(mbid, admin)).toBe('settled');
  });

  it('is failed — not settled — when every attempt failed', async () => {
    // The state that renders a message and enqueues nothing. Before this
    // existed, such an artist was indistinguishable from a completed one and
    // the page went silent.
    const mbid = artistMbid('b6');
    await seedJob(mbid, 'failed');

    expect(await expansionStateFor(mbid, admin)).toBe('failed');
  });

  it('returns to settled once the sweep has repaired a failed artist', async () => {
    const mbid = artistMbid('b7');
    await seedJob(mbid, 'failed');
    await seedJob(mbid, 'succeeded');

    expect(await expansionStateFor(mbid, admin)).toBe('settled');
  });

  it('reports an outstanding sweep re-queue as outstanding, not failed', async () => {
    // What `enqueueFailedExpansions` leaves behind: a failed row plus a fresh
    // pending one. The reader should be told work is happening.
    const mbid = artistMbid('b8');
    await seedJob(mbid, 'failed');
    await seedJob(mbid, 'pending');

    expect(await expansionStateFor(mbid, admin)).toBe('outstanding');
  });

  it('withholds expansion from Various Artists even with no prior attempt', async () => {
    // The exclusion is a scope deferral, not a ruling: `current-state.md` §11
    // keeps "whether depth applies to pseudo-artists" open, and firing here
    // would answer it implicitly.
    expect(isExcludedFromExpansion(VARIOUS_ARTISTS)).toBe(true);
    expect(await expansionStateFor(VARIOUS_ARTISTS, admin)).toBe('settled');
  });

  it('excludes on identity alone, whatever the letter case', async () => {
    expect(isExcludedFromExpansion(VARIOUS_ARTISTS.toUpperCase())).toBe(true);
  });

  it('excludes nothing else', async () => {
    expect(isExcludedFromExpansion(artistMbid('b4'))).toBe(false);
  });

  it('does not consult provenance, so a self-service artist expands too', async () => {
    // There is no provenance signal in the rule at all, which is the point:
    // an artist present because a user added one of their albums is included,
    // and included artists expand on the same terms as curated ones.
    const selfService = artistMbid('b5');

    expect(await expansionStateFor(selfService, admin)).toBe('start');
  });
});

describe('the priority the page enqueues at', () => {
  it('is below interactive work, so expansion is never claimed first', async () => {
    // The claim orders `priority asc, id asc`, so a larger number is claimed
    // later. Asserted against the stored row rather than against the constant,
    // because it is the row the claim query reads.
    const mbid = artistMbid('c1');
    await enqueueJob('discover_curated_artist', mbid, {
      priority: DEFAULT_JOB_PRIORITY,
      admin,
    });

    const { data } = await admin
      .from('ingestion_jobs')
      .select('priority')
      .eq('kind', 'discover_curated_artist')
      .eq('target_mbid', mbid)
      .single();

    expect(data!.priority).toBeGreaterThan(INTERACTIVE_JOB_PRIORITY);
  });
});
