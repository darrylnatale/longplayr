import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * The follow graph.
 *
 * **Asymmetric, and that is asserted rather than assumed.** A following B must
 * leave B following nobody. It is the one property of this table that would be
 * silently wrong if a future change introduced a reciprocal write, and nothing
 * about the schema prevents that on its own.
 *
 * The services build a cookie-bound client and cannot be called without a
 * request scope, so these issue the same statements the service issues. Where
 * that matters — the idempotency branch and the `!inner` embeds in particular —
 * the replication is exact and says so.
 *
 * **No block coverage.** Blocking is a Phase 6 feature and no `blocks` table
 * exists, so there is nothing to interact with. Recorded as a deliberate
 * absence rather than an untested path.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

/** Auth-heavy, same budget and the same reasoning as every sibling suite. */
vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds: string[] = [];

async function createUser(withProfile = true): Promise<{ id: string; handle: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `follows-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'correct-horse-battery',
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);

  const handle = `f_${stamp}`.slice(0, 30);
  if (withProfile) {
    const { error: profileError } = await admin.from('profiles').insert({ id, handle });
    if (profileError) throw profileError;
  }
  return { id, handle };
}

/** A client authenticated as one user, for the RLS assertions. */
async function clientFor(email: string, password = 'correct-horse-battery') {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function emailFor(id: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(id);
  return data.user!.email!;
}

/** The service's insert, replicated exactly. */
async function follow(followerId: string, followeeId: string) {
  return admin
    .from('follows')
    .insert({ follower_id: followerId, followee_id: followeeId })
    .select()
    .single();
}

/** The service's follower count, replicated exactly — including the `!inner`. */
async function followerCount(userId: string) {
  const { count, error } = await admin
    .from('follows')
    .select('id, person:profiles!follows_follower_id_fkey!inner(status)', {
      count: 'exact',
      head: true,
    })
    .eq('followee_id', userId)
    .eq('person.status', 'active');
  if (error) throw error;
  return count ?? 0;
}

/** The service's following count, replicated exactly. */
async function followingCount(userId: string) {
  const { count, error } = await admin
    .from('follows')
    .select('id, person:profiles!follows_followee_id_fkey!inner(status)', {
      count: 'exact',
      head: true,
    })
    .eq('follower_id', userId)
    .eq('person.status', 'active');
  if (error) throw error;
  return count ?? 0;
}

/** The service's follower list, replicated exactly. */
async function followerList(userId: string, limit = 50, offset = 0) {
  return admin
    .from('follows')
    .select(
      'created_at, person:profiles!follows_follower_id_fkey!inner(id, handle, display_name, avatar_url, status)',
      { count: 'exact' },
    )
    .eq('followee_id', userId)
    .eq('person.status', 'active')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
}

/** The service's following list, replicated exactly. */
async function followingList(userId: string, limit = 50, offset = 0) {
  return admin
    .from('follows')
    .select(
      'created_at, person:profiles!follows_followee_id_fkey!inner(id, handle, display_name, avatar_url, status)',
      { count: 'exact' },
    )
    .eq('follower_id', userId)
    .eq('person.status', 'active')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
}

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

describe('follows — invariants', () => {
  it('rejects a self-follow at the database, whatever the service does', async () => {
    const user = await createUser();

    const { error } = await follow(user.id, user.id);

    // The check constraint is the integrity boundary. The service refuses first
    // for the message; this proves the guarantee does not depend on it.
    expect(error).not.toBeNull();
    expect(error!.message).toContain('follows_no_self_follow');
  });

  it('is idempotent — following twice yields one row', async () => {
    const a = await createUser();
    const b = await createUser();

    const first = await follow(a.id, b.id);
    expect(first.error).toBeNull();

    const second = await follow(a.id, b.id);
    expect(second.error?.code).toBe('23505');

    // The service's recovery branch, replicated: on a unique violation it reads
    // the existing row back and returns it as a success.
    const { data: existing } = await admin
      .from('follows')
      .select('*')
      .eq('follower_id', a.id)
      .eq('followee_id', b.id)
      .single();

    expect(existing!.id).toBe(first.data!.id);

    const { count } = await admin
      .from('follows')
      .select('id', { count: 'exact', head: true })
      .eq('follower_id', a.id)
      .eq('followee_id', b.id);
    expect(count).toBe(1);
  });

  it('refuses a follow of an account that does not exist', async () => {
    const a = await createUser();
    const ghost = '00000000-0000-4000-8000-00000000dead';

    const { error } = await follow(a.id, ghost);

    expect(error?.code).toBe('23503');
  });

  it('refuses a follow authored by a user with no profile row', async () => {
    const noProfile = await createUser(false);
    const b = await createUser();

    const { error } = await follow(noProfile.id, b.id);

    // The foreign key to profiles is what makes a completed profile a
    // precondition for authoring. The service returns `onboarding_required`
    // before reaching this, but the constraint is what guarantees it.
    expect(error?.code).toBe('23503');
  });

  it('unfollows, and unfollowing again is a clean no-op', async () => {
    const a = await createUser();
    const b = await createUser();
    await follow(a.id, b.id);

    const first = await admin
      .from('follows')
      .delete()
      .eq('follower_id', a.id)
      .eq('followee_id', b.id);
    expect(first.error).toBeNull();

    const second = await admin
      .from('follows')
      .delete()
      .eq('follower_id', a.id)
      .eq('followee_id', b.id);
    expect(second.error).toBeNull();

    expect(await followerCount(b.id)).toBe(0);
  });
});

describe('follows — asymmetry', () => {
  it('following someone does not make them follow you back', async () => {
    const a = await createUser();
    const b = await createUser();

    await follow(a.id, b.id);

    expect(await followingCount(a.id)).toBe(1);
    expect(await followerCount(b.id)).toBe(1);

    // The half that would silently break if a reciprocal write ever appeared.
    expect(await followerCount(a.id)).toBe(0);
    expect(await followingCount(b.id)).toBe(0);
  });

  it('holds both directions as two independent rows', async () => {
    const a = await createUser();
    const b = await createUser();

    await follow(a.id, b.id);
    await follow(b.id, a.id);

    expect(await followerCount(a.id)).toBe(1);
    expect(await followingCount(a.id)).toBe(1);

    // Unfollowing one direction leaves the other untouched.
    await admin.from('follows').delete().eq('follower_id', a.id).eq('followee_id', b.id);

    expect(await followingCount(a.id)).toBe(0);
    expect(await followerCount(a.id)).toBe(1);
  });
});

describe('follows — counts', () => {
  it('counts an asymmetric graph correctly', async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();

    // A → B, C → B, B → A
    await follow(a.id, b.id);
    await follow(c.id, b.id);
    await follow(b.id, a.id);

    expect(await followerCount(b.id)).toBe(2);
    expect(await followingCount(b.id)).toBe(1);
    expect(await followerCount(a.id)).toBe(1);
    expect(await followingCount(a.id)).toBe(1);
    expect(await followerCount(c.id)).toBe(0);
    expect(await followingCount(c.id)).toBe(1);
  });

  it('excludes a suspended account from counts and from lists alike', async () => {
    const subject = await createUser();
    const active = await createUser();
    const suspended = await createUser();

    await follow(active.id, subject.id);
    await follow(suspended.id, subject.id);

    expect(await followerCount(subject.id)).toBe(2);

    await admin.from('profiles').update({ status: 'suspended' }).eq('id', suspended.id);

    // The count and the list must agree. A count of two above a list of one is
    // a discrepancy the reader cannot explain, and the count is the link into
    // the list.
    expect(await followerCount(subject.id)).toBe(1);

    const { data, count } = await followerList(subject.id);
    expect(data).toHaveLength(1);
    expect(count).toBe(1);
    expect(data![0].person.id).toBe(active.id);
  });
});

describe('follows — lists', () => {
  it('returns followers newest first, with the whole total', async () => {
    const subject = await createUser();
    const first = await createUser();
    const second = await createUser();
    const third = await createUser();

    // Sequential rather than concurrent: created_at orders the list, and
    // three inserts in one statement batch can share a timestamp.
    await follow(first.id, subject.id);
    await new Promise((r) => setTimeout(r, 10));
    await follow(second.id, subject.id);
    await new Promise((r) => setTimeout(r, 10));
    await follow(third.id, subject.id);

    const { data, count, error } = await followerList(subject.id);

    expect(error).toBeNull();
    expect(count).toBe(3);
    expect(data!.map((row) => row.person.id)).toEqual([third.id, second.id, first.id]);
  });

  it('returns the following direction independently of the follower direction', async () => {
    const subject = await createUser();
    const followed = await createUser();
    const follower = await createUser();

    await follow(subject.id, followed.id);
    await follow(follower.id, subject.id);

    const following = await followingList(subject.id);
    const followers = await followerList(subject.id);

    expect(following.data!.map((r) => r.person.id)).toEqual([followed.id]);
    expect(followers.data!.map((r) => r.person.id)).toEqual([follower.id]);
  });

  it('pages, and reports the full total on every page', async () => {
    const subject = await createUser();
    const a = await createUser();
    const b = await createUser();

    await follow(a.id, subject.id);
    await new Promise((r) => setTimeout(r, 10));
    await follow(b.id, subject.id);

    const page1 = await followerList(subject.id, 1, 0);
    const page2 = await followerList(subject.id, 1, 1);

    expect(page1.data).toHaveLength(1);
    expect(page2.data).toHaveLength(1);
    expect(page1.count).toBe(2);
    expect(page2.count).toBe(2);
    expect(page1.data![0].person.id).not.toBe(page2.data![0].person.id);
  });

  it('answers an offset past the end with the range error the service handles', async () => {
    const subject = await createUser();
    const a = await createUser();
    await follow(a.id, subject.id);

    const { error } = await followerList(subject.id, 50, 500);

    // Not a fault: the destination must be able to ask for page 9 of a list
    // that now has one and be told so. The service turns this into an empty
    // page plus a real total, which is what drives the 404.
    expect(error?.code).toBe('PGRST103');
  });

  it('carries the identity the list renders', async () => {
    const subject = await createUser();
    const follower = await createUser();
    await admin.from('profiles').update({ display_name: 'Nadia Okonkwo' }).eq('id', follower.id);
    await follow(follower.id, subject.id);

    const { data } = await followerList(subject.id);

    expect(data![0].person).toMatchObject({
      id: follower.id,
      handle: follower.handle,
      display_name: 'Nadia Okonkwo',
      avatar_url: null,
    });
  });
});

describe('follows — authorisation', () => {
  it('lets a signed-in user create only their own follow', async () => {
    const a = await createUser();
    const b = await createUser();
    const client = await clientFor(await emailFor(a.id));

    const own = await client.from('follows').insert({ follower_id: a.id, followee_id: b.id });
    expect(own.error).toBeNull();

    // Forging someone else's relationship.
    const forged = await client.from('follows').insert({ follower_id: b.id, followee_id: a.id });
    expect(forged.error).not.toBeNull();
    expect(forged.error!.code).toBe('42501');
  });

  it('lets a signed-in user delete only their own follow', async () => {
    const a = await createUser();
    const b = await createUser();
    await follow(b.id, a.id);

    const client = await clientFor(await emailFor(a.id));
    await client.from('follows').delete().eq('follower_id', b.id).eq('followee_id', a.id);

    // RLS filters the row out of the delete rather than erroring, so the proof
    // is that it survived.
    expect(await followerCount(a.id)).toBe(1);
  });

  it('is readable signed out', async () => {
    const a = await createUser();
    const b = await createUser();
    await follow(a.id, b.id);

    const anon = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon
      .from('follows')
      .select('id')
      .eq('follower_id', a.id)
      .eq('followee_id', b.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('grants no update, so a follow cannot be re-pointed', async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    await follow(a.id, b.id);

    const client = await clientFor(await emailFor(a.id));
    const { error } = await client
      .from('follows')
      .update({ followee_id: c.id })
      .eq('follower_id', a.id)
      .eq('followee_id', b.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

describe('follows — deletion', () => {
  it('removes a deleted account from both directions of the graph', async () => {
    const leaving = await createUser();
    const followedByLeaving = await createUser();
    const followingLeaving = await createUser();

    await follow(leaving.id, followedByLeaving.id);
    await follow(followingLeaving.id, leaving.id);

    expect(await followerCount(followedByLeaving.id)).toBe(1);
    expect(await followingCount(followingLeaving.id)).toBe(1);

    await admin.auth.admin.deleteUser(leaving.id);
    createdUserIds.splice(createdUserIds.indexOf(leaving.id), 1);

    // Hard delete with a complete cascade: an orphaned row is a privacy
    // failure, and a follow names two people.
    expect(await followerCount(followedByLeaving.id)).toBe(0);
    expect(await followingCount(followingLeaving.id)).toBe(0);

    const { count } = await admin
      .from('follows')
      .select('id', { count: 'exact', head: true })
      .or(`follower_id.eq.${leaving.id},followee_id.eq.${leaving.id}`);
    expect(count).toBe(0);
  });
});
