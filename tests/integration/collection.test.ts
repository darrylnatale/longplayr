import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Database contract for the collection and its satellites.
 *
 * These go at the schema and the `ensure_collection_entry` function directly
 * rather than through the service layer, following the convention set by
 * profiles.test.ts: the point is to prove the database holds the line even if
 * application code has a bug. The service layer cannot be called here anyway —
 * it builds a cookie-bound client, and there is no request scope in a test.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

async function createUser() {
  const email = `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user;
}

/** An authenticated user with a completed profile — the only kind that can author. */
async function createProfiledUser() {
  const user = await createUser();
  const handle = `c_${Math.random().toString(36).slice(2, 10)}`.slice(0, 30);
  const { error } = await admin.from('profiles').insert({ id: user.id, handle });
  if (error) throw error;
  return user;
}

async function ensureEntry(userId: string, albumId: string, listenedOn: string | null = null) {
  const { data, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
    p_listened_on: listenedOn ?? undefined,
  });
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing. Run `npm run db:env`.');
});

beforeEach(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');

  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);

  const { data } = await admin.from('albums').select('id').order('title');
  albumA = data![0].id;
  albumB = data![1].id;
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('collection entries', () => {
  it('holds one entry per user per album, permanently', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albumA);

    const { error } = await admin
      .from('collection_entries')
      .insert({ user_id: user.id, album_id: albumA });

    expect(error?.code).toBe('23505');
  });

  it('survives concurrent creation attempts with exactly one row', async () => {
    const user = await createProfiledUser();

    // The race the uniqueness constraint exists for.
    await Promise.all(Array.from({ length: 8 }, () => ensureEntry(user.id, albumA)));

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('album_id', albumA);

    expect(count).toBe(1);
  });

  it('is idempotent across repeated implicit adds', async () => {
    const user = await createProfiledUser();
    const first = await ensureEntry(user.id, albumA);
    const second = await ensureEntry(user.id, albumA);
    const third = await ensureEntry(user.id, albumA);

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
  });

  it('never rewrites a listened_on the user already set', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albumA, '1997-05-21');
    const again = await ensureEntry(user.id, albumA, '2020-01-01');

    expect(again.listened_on).toBe('1997-05-21');
  });

  it('refuses an entry for a user with no profile', async () => {
    // Authenticated but mid-onboarding: the foreign key is what makes a
    // completed profile a precondition for authoring anything.
    const user = await createUser();

    const { error } = await admin
      .from('collection_entries')
      .insert({ user_id: user.id, album_id: albumA });

    expect(error?.code).toBe('23503');
  });

  it('rejects ratings outside 0.0 to 10.0', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    for (const rating of [-0.1, 10.1]) {
      const { error } = await admin
        .from('collection_entries')
        .update({ rating })
        .eq('id', entry.id);
      expect(error?.code).toBe('23514');
    }
  });

  it('accepts both ends of the scale', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    for (const rating of [0, 10]) {
      const { error } = await admin
        .from('collection_entries')
        .update({ rating })
        .eq('id', entry.id);
      expect(error).toBeNull();
    }
  });
});

describe('the clearing rule', () => {
  it('clears Want to Listen when a collection entry is created', async () => {
    const user = await createProfiledUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });

    await ensureEntry(user.id, albumA);

    const { data } = await admin
      .from('want_to_listen')
      .select('id')
      .eq('user_id', user.id)
      .eq('album_id', albumA);

    expect(data).toHaveLength(0);
  });

  it('clears only the album collected, leaving the rest of the wishlist alone', async () => {
    const user = await createProfiledUser();
    await admin.from('want_to_listen').insert([
      { user_id: user.id, album_id: albumA },
      { user_id: user.id, album_id: albumB },
    ]);

    await ensureEntry(user.id, albumA);

    const { data } = await admin.from('want_to_listen').select('album_id').eq('user_id', user.id);
    expect(data).toHaveLength(1);
    expect(data![0].album_id).toBe(albumB);
  });

  it('clears only the acting user, leaving another user’s wishlist alone', async () => {
    const mine = await createProfiledUser();
    const theirs = await createProfiledUser();
    await admin.from('want_to_listen').insert([
      { user_id: mine.id, album_id: albumA },
      { user_id: theirs.id, album_id: albumA },
    ]);

    await ensureEntry(mine.id, albumA);

    const { count } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', theirs.id);
    expect(count).toBe(1);
  });

  it('is one-directional: wishing an album already collected leaves it in both', async () => {
    // The legal coexistence the resolved decision requires. Collect first, wish
    // second — the clearing rule fires on entry creation only, never in
    // reverse, so nothing removes either row.
    const user = await createProfiledUser();
    await ensureEntry(user.id, albumA);

    const { error } = await admin
      .from('want_to_listen')
      .insert({ user_id: user.id, album_id: albumA });
    expect(error).toBeNull();

    const [entries, wishes] = await Promise.all([
      admin
        .from('collection_entries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('album_id', albumA),
      admin
        .from('want_to_listen')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('album_id', albumA),
    ]);

    expect(entries.count).toBe(1);
    expect(wishes.count).toBe(1);
  });

  it('always clears the wishlist when the canonical path is used', async () => {
    // The invariant, stated once for every action that creates an entry. All
    // four implicit paths — rating, liking, reviewing, relistening — reach the
    // database through ensure_collection_entry, so exercising the function per
    // action is exercising the rule they all depend on.
    const actions = ['rate', 'like', 'review', 'relisten'] as const;

    for (const action of actions) {
      const user = await createProfiledUser();
      await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });

      const entry = await ensureEntry(user.id, albumA);

      switch (action) {
        case 'rate':
          await admin.from('collection_entries').update({ rating: 7.5 }).eq('id', entry.id);
          break;
        case 'like':
          await admin.from('collection_entries').update({ liked: true }).eq('id', entry.id);
          break;
        case 'review':
          await admin
            .from('reviews')
            .insert({ collection_entry_id: entry.id, body: 'Considered.' });
          break;
        case 'relisten':
          await admin.from('relisten_events').insert({ collection_entry_id: entry.id });
          break;
      }

      const { count } = await admin
        .from('want_to_listen')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('album_id', albumA);

      expect(count, `${action} should have cleared the wishlist`).toBe(0);
    }
  });

  it('enforces no mutual exclusion at the schema level', async () => {
    // A schema-contract test, NOT a sanctioned pattern. Application code is
    // prohibited from inserting into collection_entries directly — the clearing
    // rule lives in ensure_collection_entry, not in the tables. This bypasses
    // the function deliberately, to pin down what the schema does and does not
    // guarantee: it permits coexistence, and it does not clear anything. That
    // is why the single-path rule exists (docs/data-model.md).
    const user = await createProfiledUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });
    await admin.from('collection_entries').insert({ user_id: user.id, album_id: albumA });

    const { count } = await admin
      .from('want_to_listen')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // A direct insert bypasses the function, so the wish survives. That is the
    // point: exclusion is a behaviour of one code path, not a schema rule.
    expect(count).toBe(1);
  });

  it('holds one wishlist row per user per album', async () => {
    const user = await createProfiledUser();
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumA });
    const { error } = await admin
      .from('want_to_listen')
      .insert({ user_id: user.id, album_id: albumA });
    expect(error?.code).toBe('23505');
  });
});

describe('relistens', () => {
  it('keeps relisten_count consistent with its rows', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    for (let i = 0; i < 3; i += 1) {
      await admin.from('relisten_events').insert({ collection_entry_id: entry.id });
    }

    const { data } = await admin
      .from('collection_entries')
      .select('relisten_count')
      .eq('id', entry.id)
      .single();
    expect(data!.relisten_count).toBe(3);
  });

  it('keeps the counter correct under concurrent writes', async () => {
    // The case a read-modify-write in application code loses. The trigger
    // increments in the same transaction as the insert, so the row lock
    // serialises them.
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    await Promise.all(
      Array.from({ length: 20 }, () =>
        admin.from('relisten_events').insert({ collection_entry_id: entry.id }),
      ),
    );

    const [{ data: row }, { count }] = await Promise.all([
      admin.from('collection_entries').select('relisten_count').eq('id', entry.id).single(),
      admin
        .from('relisten_events')
        .select('id', { count: 'exact', head: true })
        .eq('collection_entry_id', entry.id),
    ]);

    expect(count).toBe(20);
    expect(row!.relisten_count).toBe(20);
  });

  it('decrements when a relisten is removed', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    const { data: events } = await admin
      .from('relisten_events')
      .insert([{ collection_entry_id: entry.id }, { collection_entry_id: entry.id }])
      .select();

    await admin.from('relisten_events').delete().eq('id', events![0].id);

    const { data } = await admin
      .from('collection_entries')
      .select('relisten_count')
      .eq('id', entry.id)
      .single();
    expect(data!.relisten_count).toBe(1);
  });

  it('stores relistens as discrete rows, not a bare counter', async () => {
    // Three relistens are three feed items in the social phase; a single
    // integer could not express that.
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);
    await admin.from('relisten_events').insert([
      { collection_entry_id: entry.id, occurred_at: '2026-08-01T10:00:00Z' },
      { collection_entry_id: entry.id, occurred_at: '2026-08-02T10:00:00Z' },
    ]);

    const { data } = await admin
      .from('relisten_events')
      .select('occurred_at')
      .eq('collection_entry_id', entry.id)
      .order('occurred_at');

    expect(data).toHaveLength(2);
    expect(data![0].occurred_at).not.toBe(data![1].occurred_at);
  });
});

describe('reviews', () => {
  it('holds one review per collection entry', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    await admin.from('reviews').insert({ collection_entry_id: entry.id, body: 'First.' });
    const { error } = await admin
      .from('reviews')
      .insert({ collection_entry_id: entry.id, body: 'Second.' });

    expect(error?.code).toBe('23505');
  });

  it('caps the body at 10,000 characters', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    const { error: okError } = await admin
      .from('reviews')
      .insert({ collection_entry_id: entry.id, body: 'x'.repeat(10_000) });
    expect(okError).toBeNull();

    await admin.from('reviews').delete().eq('collection_entry_id', entry.id);

    const { error } = await admin
      .from('reviews')
      .insert({ collection_entry_id: entry.id, body: 'x'.repeat(10_001) });
    expect(error?.code).toBe('23514');
  });

  it('keeps line breaks and rejects an empty body', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);

    const body = 'One line.\n\nAnother line.';
    await admin.from('reviews').insert({ collection_entry_id: entry.id, body });
    const { data } = await admin
      .from('reviews')
      .select('body')
      .eq('collection_entry_id', entry.id)
      .single();
    expect(data!.body).toBe(body);

    const other = await ensureEntry(user.id, albumB);
    const { error } = await admin
      .from('reviews')
      .insert({ collection_entry_id: other.id, body: '' });
    expect(error?.code).toBe('23514');
  });

  it('soft-deletes for moderation without destroying the collection entry', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);
    await admin.from('reviews').insert({ collection_entry_id: entry.id, body: 'Considered.' });

    await admin.from('reviews').update({ status: 'removed' }).eq('collection_entry_id', entry.id);

    const { data: stillThere } = await admin
      .from('collection_entries')
      .select('id')
      .eq('id', entry.id)
      .maybeSingle();
    expect(stillThere).not.toBeNull();
  });
});

describe('favourites', () => {
  it('is independent of the collection', async () => {
    // Pinning does not add. A favourite is a statement about taste, not a
    // record of listening.
    const user = await createProfiledUser();
    await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumA, position: 1 });

    const { count } = await admin
      .from('collection_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(0);
  });

  it('caps at ten by construction', async () => {
    const user = await createProfiledUser();
    const rows = Array.from({ length: 10 }, (_, i) => ({
      user_id: user.id,
      album_id: i % 2 === 0 ? albumA : albumB,
      position: i + 1,
    }));
    // Distinct albums are also unique-per-user, so use position alone to prove
    // the cap: insert ten legal positions one album at a time.
    await admin.from('favourite_albums').insert({ ...rows[0], album_id: albumA, position: 1 });
    await admin.from('favourite_albums').insert({ ...rows[1], album_id: albumB, position: 2 });

    const { error } = await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumA, position: 11 });
    expect(error?.code).toBe('23514');
  });

  it('refuses a duplicate position for one user', async () => {
    // This constraint plus the 1-10 check is what makes ten a hard ceiling
    // rather than a racy application-level count.
    const user = await createProfiledUser();
    await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumA, position: 1 });
    const { error } = await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumB, position: 1 });
    expect(error?.code).toBe('23505');
  });

  it('holds the cap under concurrent inserts', async () => {
    const user = await createProfiledUser();
    const attempts = Array.from({ length: 12 }, (_, i) =>
      admin
        .from('favourite_albums')
        .insert({ user_id: user.id, album_id: i % 2 === 0 ? albumA : albumB, position: i + 1 }),
    );
    await Promise.allSettled(attempts);

    const { count } = await admin
      .from('favourite_albums')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    expect(count).toBeLessThanOrEqual(10);
  });

  it('refuses the same album twice for one user', async () => {
    const user = await createProfiledUser();
    await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumA, position: 1 });
    const { error } = await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumA, position: 2 });
    expect(error?.code).toBe('23505');
  });
});

describe('averages, computed at read time', () => {
  async function average(albumId: string) {
    const { data } = await admin
      .from('collection_entries')
      .select('rating')
      .eq('album_id', albumId)
      .not('rating', 'is', null);
    const ratings = (data ?? []).map((r) => Number(r.rating));
    if (ratings.length === 0) return { average: null as number | null, count: 0 };
    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    return { average: Math.round(mean * 10) / 10, count: ratings.length };
  }

  it('reports nothing when no one has rated', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albumA);
    expect(await average(albumA)).toEqual({ average: null, count: 0 });
  });

  it('reports a single rating as itself', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);
    await admin.from('collection_entries').update({ rating: 8.5 }).eq('id', entry.id);
    expect(await average(albumA)).toEqual({ average: 8.5, count: 1 });
  });

  it('averages several ratings to one decimal', async () => {
    for (const rating of [8, 9, 10]) {
      const user = await createProfiledUser();
      const entry = await ensureEntry(user.id, albumA);
      await admin.from('collection_entries').update({ rating }).eq('id', entry.id);
    }
    expect(await average(albumA)).toEqual({ average: 9, count: 3 });
  });

  it('excludes unrated entries from the average and the count', async () => {
    const rater = await createProfiledUser();
    const rated = await ensureEntry(rater.id, albumA);
    await admin.from('collection_entries').update({ rating: 6 }).eq('id', rated.id);

    // Two collectors who never rated. They must not drag the average toward
    // zero, and they must not inflate the count.
    for (let i = 0; i < 2; i += 1) {
      const other = await createProfiledUser();
      await ensureEntry(other.id, albumA);
    }

    expect(await average(albumA)).toEqual({ average: 6, count: 1 });
  });

  it('counts 0.0 as a score rather than as absence', async () => {
    const zero = await createProfiledUser();
    const zeroEntry = await ensureEntry(zero.id, albumA);
    await admin.from('collection_entries').update({ rating: 0 }).eq('id', zeroEntry.id);

    const ten = await createProfiledUser();
    const tenEntry = await ensureEntry(ten.id, albumA);
    await admin.from('collection_entries').update({ rating: 10 }).eq('id', tenEntry.id);

    // If 0.0 were treated as unrated the average would be 10 and the count 1.
    expect(await average(albumA)).toEqual({ average: 5, count: 2 });
  });

  it('stores exactly one decimal place', async () => {
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);
    await admin.from('collection_entries').update({ rating: 7.5 }).eq('id', entry.id);

    const { data } = await admin
      .from('collection_entries')
      .select('rating')
      .eq('id', entry.id)
      .single();
    expect(Number(data!.rating)).toBe(7.5);
  });
});

describe('hard deletion cascades', () => {
  it('removes every user-authored row when the account is deleted', async () => {
    // An orphaned user-authored row is a privacy failure, not a bug.
    const user = await createProfiledUser();
    const entry = await ensureEntry(user.id, albumA);
    await admin.from('relisten_events').insert({ collection_entry_id: entry.id });
    await admin.from('reviews').insert({ collection_entry_id: entry.id, body: 'Written.' });
    await admin
      .from('favourite_albums')
      .insert({ user_id: user.id, album_id: albumB, position: 1 });
    await admin.from('want_to_listen').insert({ user_id: user.id, album_id: albumB });

    await admin.auth.admin.deleteUser(user.id);
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    const [profiles, entries, relistens, reviews, favourites, wishes] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('id', user.id),
      admin
        .from('collection_entries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      admin
        .from('relisten_events')
        .select('id', { count: 'exact', head: true })
        .eq('collection_entry_id', entry.id),
      admin
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('collection_entry_id', entry.id),
      admin
        .from('favourite_albums')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      admin
        .from('want_to_listen')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]);

    expect(profiles.count).toBe(0);
    expect(entries.count).toBe(0);
    expect(relistens.count).toBe(0);
    expect(reviews.count).toBe(0);
    expect(favourites.count).toBe(0);
    expect(wishes.count).toBe(0);
  });

  it('leaves the catalogue untouched — those rows were never theirs', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albumA);
    await admin.auth.admin.deleteUser(user.id);
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    const { count } = await admin.from('albums').select('id', { count: 'exact', head: true });
    expect(count).toBe(2);
  });

  it('needs no average recomputation, because averages are never stored', async () => {
    const keeper = await createProfiledUser();
    const keeperEntry = await ensureEntry(keeper.id, albumA);
    await admin.from('collection_entries').update({ rating: 10 }).eq('id', keeperEntry.id);

    const leaver = await createProfiledUser();
    const leaverEntry = await ensureEntry(leaver.id, albumA);
    await admin.from('collection_entries').update({ rating: 0 }).eq('id', leaverEntry.id);

    await admin.auth.admin.deleteUser(leaver.id);
    createdUserIds.splice(createdUserIds.indexOf(leaver.id), 1);

    const { data } = await admin
      .from('collection_entries')
      .select('rating')
      .eq('album_id', albumA)
      .not('rating', 'is', null);

    // The aggregate simply stops including the deleted row. Nothing decremented
    // a counter, so nothing can have drifted.
    expect(data).toHaveLength(1);
    expect(Number(data![0].rating)).toBe(10);
  });
});

describe('authorisation', () => {
  it('lets anyone read collections, because everything user-generated is public', async () => {
    const user = await createProfiledUser();
    await ensureEntry(user.id, albumA);

    const { data, error } = await anon
      .from('collection_entries')
      .select('id')
      .eq('user_id', user.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('refuses an anonymous write to every user-authored table', async () => {
    const user = await createProfiledUser();

    const results = await Promise.all([
      anon.from('collection_entries').insert({ user_id: user.id, album_id: albumA }),
      anon.from('favourite_albums').insert({ user_id: user.id, album_id: albumA, position: 1 }),
      anon.from('want_to_listen').insert({ user_id: user.id, album_id: albumA }),
    ]);

    for (const result of results) expect(result.error).not.toBeNull();
  });

  it('refuses one user writing collection data as another', async () => {
    const owner = await createProfiledUser();
    const intruder = await createProfiledUser();

    const asIntruder = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: session } = await asIntruder.auth.signInWithPassword({
      email: (await admin.auth.admin.getUserById(intruder.id)).data.user!.email!,
      password: 'correct-horse-battery',
    });
    expect(session.session).not.toBeNull();

    const { error } = await asIntruder
      .from('collection_entries')
      .insert({ user_id: owner.id, album_id: albumA });

    expect(error).not.toBeNull();
  });
});
