import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { singleArtistAlbum } from '@/services/catalogue/fixtures';
import * as ingest from '@/services/catalogue/ingest';
import {
  addAlbumFromUpstream,
  RATE_LIMIT_PER_DAY,
  RATE_LIMIT_PER_HOUR,
  remainingAllowance,
} from '@/services/catalogue/self-service';
import { enqueueJob } from '@/services/catalogue/jobs';
import { DEFAULT_JOB_PRIORITY, INTERACTIVE_JOB_PRIORITY } from '@/services/catalogue/queue';
import * as profiles from '@/services/profiles';

/**
 * Self-service addition integrity.
 *
 * The invariant: an addition that reaches the catalogue always has a
 * catalogue_additions row. It did not hold. catalogue_additions.user_id is a
 * foreign key to `profiles`, not auth.users, so an authenticated user who had
 * not chosen a handle violated it — and the insert error was discarded, so the
 * album was written, the artwork job queued, and nothing recorded who did it.
 * Because remainingAllowance counts those rows, that user was also exempt from
 * the 30/hour and 100/day limits entirely.
 */

/**
 * Auth-heavy: this file creates real users through GoTrue and signs in as them.
 *
 * Those calls are fast in the median — around 100ms — but have a long tail:
 * measured over 2,369 requests, 0.4% exceed a second and the worst observed was
 * 4.2s. A test making half a dozen of them can therefore blow Vitest's 5s
 * default through no fault of its own, which is exactly what happened to three
 * rating tests that passed in isolation seconds later.
 *
 * 15s covers the p99 across those calls plus one worst-case outlier, with room
 * to spare. It is set here rather than on the whole project so the tests that
 * never touch auth keep the tight budget — those are the ones that would notice
 * a query getting slower.
 */
vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const MBID = singleArtistAlbum.id;
/** Any other target, standing in for queued background work. */
const BACKFILL_MBID = '0b0e4f1e-1111-4000-8000-0000000000bb';
const createdUserIds: string[] = [];

async function createUser() {
  const email = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user;
}

/** An authenticated user who has chosen a handle. */
async function onboardedUser() {
  const user = await createUser();
  const handle = `ss_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { data, error } = await admin
    .from('profiles')
    .insert({ id: user.id, handle })
    .select('*')
    .single();
  if (error) throw error;

  vi.spyOn(profiles, 'getCurrentUser').mockResolvedValue(user);
  vi.spyOn(profiles, 'getCurrentProfile').mockResolvedValue(data);
  return { user, profile: data };
}

/** Authenticated, but mid-onboarding: no profile row exists yet. */
async function userWithoutProfile() {
  const user = await createUser();
  vi.spyOn(profiles, 'getCurrentUser').mockResolvedValue(user);
  vi.spyOn(profiles, 'getCurrentProfile').mockResolvedValue(null);
  return user;
}

/** Ingest succeeds without touching MusicBrainz. */
function stubIngest() {
  return vi.spyOn(ingest, 'ingestReleaseGroup').mockImplementation(async (mbid, client) => {
    const { data } = await (client ?? admin)
      .from('albums')
      .upsert(
        {
          mbid: mbid as string,
          title: 'In Rainbows',
          display_credit: 'Radiohead',
          primary_type: 'album',
        },
        { onConflict: 'mbid' },
      )
      .select('id')
      .single();
    return { status: 'ingested', albumId: data!.id, mbid: mbid as string };
  });
}

async function clearCatalogue() {
  await admin.from('catalogue_additions').delete().gte('id', 0);
  await admin.from('ingestion_jobs').delete().gte('id', 0);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
}

beforeEach(clearCatalogue);
afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await clearCatalogue();
  // Deleted concurrently. Sequentially this was one round-trip per user — 40
  // to 70 of them in the larger files, at roughly 100ms each, which put the
  // hook within a second or two of Vitest's 5s default before anything went
  // wrong. Each delete targets a distinct user, so there is no ordering between
  // them and nothing to serialise.
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)));
});

async function additionCount() {
  const { count } = await admin
    .from('catalogue_additions')
    .select('id', { count: 'exact', head: true });
  return count ?? 0;
}

async function albumCount() {
  const { count } = await admin.from('albums').select('id', { count: 'exact', head: true });
  return count ?? 0;
}

describe('an onboarded user', () => {
  it('adds the album and records the audit row', async () => {
    const { profile } = await onboardedUser();
    stubIngest();

    const result = await addAlbumFromUpstream(MBID);

    expect(result.ok).toBe(true);
    expect(await albumCount()).toBe(1);

    const { data } = await admin.from('catalogue_additions').select('*').single();
    expect(data).toMatchObject({ album_mbid: MBID, user_id: profile.id });
  });

  it('queues artwork as a follow-up', async () => {
    await onboardedUser();
    stubIngest();

    await addAlbumFromUpstream(MBID);

    const { data } = await admin.from('ingestion_jobs').select('kind, target_mbid').single();
    expect(data).toMatchObject({ kind: 'fetch_artwork', target_mbid: MBID });
  });

  it('queues it ahead of background work, because a person is waiting', async () => {
    await onboardedUser();
    stubIngest();

    await addAlbumFromUpstream(MBID);

    const { data } = await admin.from('ingestion_jobs').select('priority').single();
    expect(data!.priority).toBe(INTERACTIVE_JOB_PRIORITY);
    expect(INTERACTIVE_JOB_PRIORITY).toBeLessThan(DEFAULT_JOB_PRIORITY);
  });

  it('is claimed before a backfill job already sitting in the queue', async () => {
    // The property the priority exists for, proven through the claim function
    // rather than by reading the column back. Without it a self-service add
    // sits behind however much backfill happens to be queued, and the cover
    // arrives on the next daily cron after all.
    await onboardedUser();
    stubIngest();

    await enqueueJob('fetch_artwork', BACKFILL_MBID, { admin });
    await addAlbumFromUpstream(MBID);

    const { data: claimed, error } = await admin.rpc('claim_ingestion_jobs', { batch_size: 1 });
    if (error) throw error;

    expect(claimed).toHaveLength(1);
    expect(claimed![0].target_mbid).toBe(MBID);
  });
});

describe('a user without a profile', () => {
  it('is refused, and adds nothing', async () => {
    await userWithoutProfile();
    const ingestSpy = stubIngest();

    const result = await addAlbumFromUpstream(MBID);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('onboarding_required');

    // The point of the guard: nothing reached the catalogue, so there is no
    // addition for the audit table to be missing.
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(await albumCount()).toBe(0);
    expect(await additionCount()).toBe(0);
  });

  it('cannot add an album while contributing no audit row', async () => {
    await userWithoutProfile();
    stubIngest();

    await addAlbumFromUpstream(MBID);

    // The exact combination observed on staging — album present, audit empty —
    // must now be unreachable.
    const albums = await albumCount();
    const additions = await additionCount();
    expect({ albums, additions }).toEqual({ albums: 0, additions: 0 });
  });

  it('is refused before the rate limit is even consulted', async () => {
    const user = await userWithoutProfile();

    await addAlbumFromUpstream(MBID);

    // No rows means the allowance is untouched, which is what made the bypass
    // unbounded: additions that never counted could never exhaust anything.
    expect(await remainingAllowance(user.id)).toEqual({
      hour: RATE_LIMIT_PER_HOUR,
      day: RATE_LIMIT_PER_DAY,
    });
  });
});

describe('a failed audit insert', () => {
  it('throws rather than reporting success', async () => {
    const { profile } = await onboardedUser();
    stubIngest();

    // Simulates the audit row failing for a reason the guard cannot prevent —
    // the profile deleted between the check and the insert.
    await admin.from('profiles').delete().eq('id', profile.id);

    // Unexpected failures throw (src/services/result.ts). What must not happen
    // is ok() with no audit row, which is precisely the old behaviour.
    await expect(addAlbumFromUpstream(MBID)).rejects.toThrow();
    expect(await additionCount()).toBe(0);
  });
});

describe('allowance', () => {
  it('starts at the full limit', async () => {
    const { user } = await onboardedUser();
    expect(await remainingAllowance(user.id)).toEqual({
      hour: RATE_LIMIT_PER_HOUR,
      day: RATE_LIMIT_PER_DAY,
    });
  });

  it('decrements as additions are recorded', async () => {
    const { user, profile } = await onboardedUser();

    await admin.from('catalogue_additions').insert([
      { user_id: profile.id, album_mbid: MBID },
      { user_id: profile.id, album_mbid: '0b0e4f1e-1111-4000-8000-0000000000bb' },
    ]);

    expect(await remainingAllowance(user.id)).toEqual({
      hour: RATE_LIMIT_PER_HOUR - 2,
      day: RATE_LIMIT_PER_DAY - 2,
    });
  });

  it('ignores additions outside the window', async () => {
    const { user, profile } = await onboardedUser();

    await admin.from('catalogue_additions').insert({
      user_id: profile.id,
      album_mbid: MBID,
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });

    expect(await remainingAllowance(user.id)).toEqual({
      hour: RATE_LIMIT_PER_HOUR,
      day: RATE_LIMIT_PER_DAY,
    });
  });

  it('refuses the add once the hourly limit is spent', async () => {
    const { profile } = await onboardedUser();
    stubIngest();

    await admin.from('catalogue_additions').insert(
      Array.from({ length: RATE_LIMIT_PER_HOUR }, (_, i) => ({
        user_id: profile.id,
        album_mbid: `0b0e4f1e-1111-4000-8000-${String(i).padStart(12, '0')}`,
      })),
    );

    const result = await addAlbumFromUpstream(MBID);

    expect(result.ok === false && result.error).toBe('rate_limited');
    expect(await albumCount()).toBe(0);
  });
});

describe('repeated attempts', () => {
  it('does not duplicate the album', async () => {
    await onboardedUser();
    stubIngest();

    await addAlbumFromUpstream(MBID);
    await addAlbumFromUpstream(MBID);

    expect(await albumCount()).toBe(1);
  });

  it('short-circuits on an album already held, spending no upstream request', async () => {
    await onboardedUser();
    const ingestSpy = stubIngest();

    await addAlbumFromUpstream(MBID);
    expect(ingestSpy).toHaveBeenCalledTimes(1);

    const second = await addAlbumFromUpstream(MBID);

    // Already present, so the second attempt returns without a second ingest.
    // It records no audit row either, which is consistent: nothing was added.
    expect(second.ok).toBe(true);
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(await additionCount()).toBe(1);
  });
});

describe('upstream failure', () => {
  it('records no audit row when the ingest fails', async () => {
    await onboardedUser();
    vi.spyOn(ingest, 'ingestReleaseGroup').mockRejectedValue(new Error('MusicBrainz returned 503'));

    const result = await addAlbumFromUpstream(MBID);

    expect(result.ok === false && result.error).toBe('upstream_unavailable');
    expect(await albumCount()).toBe(0);
    expect(await additionCount()).toBe(0);
  });

  it('records no audit row when the release group is out of scope', async () => {
    await onboardedUser();
    vi.spyOn(ingest, 'ingestReleaseGroup').mockResolvedValue({
      status: 'out_of_scope',
      mbid: MBID,
      reason: 'primary type "single" is out of scope',
    });

    const result = await addAlbumFromUpstream(MBID);

    expect(result.ok === false && result.error).toBe('out_of_scope');
    expect(await additionCount()).toBe(0);
  });
});
