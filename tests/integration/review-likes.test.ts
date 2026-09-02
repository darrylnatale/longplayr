import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';
import { collaborationAlbum, singleArtistAlbum } from '@/services/catalogue/fixtures';
import { ingestReleaseGroupPayload } from '@/services/catalogue/ingest';

/**
 * Review likes, against the real database.
 *
 * **Everything here runs through a signed-in `authenticated` client, never the
 * service-role one.** The public-readability rule lives in the write policy and
 * defers to `reviews_public_read`; a service-role client bypasses RLS entirely
 * and would pass every assertion below while proving nothing about the property
 * that matters.
 *
 * **Two guarantees of different strength are both pinned here, deliberately.**
 * One like per user per review is enforced by the database. A self-like is
 * refused by the service and **not** by the database — there is a test for each,
 * and the second exists so that anyone later tightening the policy into an
 * integrity boundary breaks a test rather than quietly changing the contract.
 *
 * The services build a cookie-bound client and cannot be called without a
 * request scope, so these issue the statements the services issue. Where that
 * matters the replication is exact and says so.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 20_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'correct-horse-battery';
const createdUserIds: string[] = [];
let albumA: string;
let albumB: string;

async function createUser(): Promise<{ id: string; email: string; handle: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `rl-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const id = data.user!.id;
  createdUserIds.push(id);
  const handle = `rl_${stamp}`.slice(0, 30);
  const { error: profileError } = await admin.from('profiles').insert({ id, handle });
  if (profileError) throw profileError;
  return { id, email, handle };
}

/** A client carrying a real session, so RLS applies as it does in the app. */
async function signedInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** `saveReview`'s statements: ensure the entry, then insert the review. */
async function writeReview(
  userId: string,
  albumId: string,
  body = 'A considered paragraph.',
  status: 'live' | 'removed' = 'live',
) {
  const { data: entry, error } = await admin.rpc('ensure_collection_entry', {
    p_user_id: userId,
    p_album_id: albumId,
  });
  if (error) throw error;

  const { data: review, error: reviewError } = await admin
    .from('reviews')
    .insert({
      collection_entry_id: (entry as unknown as { id: string }).id,
      body,
      status,
    })
    .select()
    .single();
  if (reviewError) throw reviewError;
  return review;
}

/** `likeReview`'s insert, as the signed-in user. */
function like(client: SupabaseClient<Database>, userId: string, reviewId: string) {
  return client.from('review_likes').insert({ user_id: userId, review_id: reviewId }).select();
}

async function likesOn(reviewId: string) {
  const { data, error } = await admin.from('review_likes').select('*').eq('review_id', reviewId);
  if (error) throw error;
  return data ?? [];
}

async function activityCountFor(userId: string) {
  const { count, error } = await admin
    .from('activity')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', userId);
  if (error) throw error;
  return count ?? 0;
}

beforeEach(async () => {
  await admin.from('review_likes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('activity').delete().neq('id', '00000000-0000-0000-0000-000000000000');
});

beforeEach(async () => {
  if (albumA) return;
  await ingestReleaseGroupPayload(singleArtistAlbum, admin);
  await ingestReleaseGroupPayload(collaborationAlbum, admin);
  const { data } = await admin.from('albums').select('id, mbid').order('mbid');
  albumA = data![0].id;
  albumB = data![1].id;
});

afterAll(async () => {
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  await admin.from('artists').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('liking a review', () => {
  it('creates exactly one row', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    const { error } = await like(client, liker.id, review.id);

    expect(error).toBeNull();
    expect(await likesOn(review.id)).toHaveLength(1);
  });

  it('refuses a second like from the same user', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    await like(client, liker.id, review.id);
    const { error } = await like(client, liker.id, review.id);

    // The unique constraint is the integrity boundary; the service turns this
    // into a clean outcome rather than preventing the collision.
    expect(error?.code).toBe('23505');
    expect(await likesOn(review.id)).toHaveLength(1);
  });

  it('survives concurrent duplicate attempts with exactly one row', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    await Promise.all([
      like(client, liker.id, review.id),
      like(client, liker.id, review.id),
      like(client, liker.id, review.id),
    ]);

    expect(await likesOn(review.id)).toHaveLength(1);
  });

  it('lets two different users like the same review', async () => {
    const author = await createUser();
    const first = await createUser();
    const second = await createUser();
    const review = await writeReview(author.id, albumA);

    await like(await signedInAs(first.email), first.id, review.id);
    await like(await signedInAs(second.email), second.id, review.id);

    expect(await likesOn(review.id)).toHaveLength(2);
  });
});

describe('unliking', () => {
  it('removes the row', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    await like(client, liker.id, review.id);

    const { error } = await client
      .from('review_likes')
      .delete()
      .eq('user_id', liker.id)
      .eq('review_id', review.id);

    expect(error).toBeNull();
    expect(await likesOn(review.id)).toHaveLength(0);
  });

  it('is a clean no-op when there is nothing to remove', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    const { error } = await client
      .from('review_likes')
      .delete()
      .eq('user_id', liker.id)
      .eq('review_id', review.id);

    expect(error).toBeNull();
    expect(await likesOn(review.id)).toHaveLength(0);
  });

  /**
   * The primitive the Notifications slice inherits: nothing is revived. A
   * notification hanging off the first like cascades away with it, and the
   * re-like is a new subject rather than the old one returning.
   */
  it('re-liking creates a fresh row with a new id', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    const { data: first } = await like(client, liker.id, review.id);
    const firstId = first![0].id;

    await client.from('review_likes').delete().eq('user_id', liker.id).eq('review_id', review.id);
    const { data: second } = await like(client, liker.id, review.id);

    expect(second![0].id).not.toBe(firstId);
    expect(await likesOn(review.id)).toHaveLength(1);
  });
});

describe('cascades', () => {
  it('deleting the review removes its likes', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    await like(await signedInAs(liker.email), liker.id, review.id);
    expect(await likesOn(review.id)).toHaveLength(1);

    await admin.from('reviews').delete().eq('id', review.id);

    expect(await likesOn(review.id)).toHaveLength(0);
  });

  it("deleting the liker's account removes their likes", async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    await like(await signedInAs(liker.email), liker.id, review.id);
    expect(await likesOn(review.id)).toHaveLength(1);

    await admin.auth.admin.deleteUser(liker.id);

    expect(await likesOn(review.id)).toHaveLength(0);
  });
});

describe('what may be liked', () => {
  it('allows a live review by another user', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const { error } = await like(await signedInAs(liker.email), liker.id, review.id);

    expect(error).toBeNull();
  });

  /**
   * **The property that requires the `exists` clause in the write policy.** The
   * policy subquery has `reviews_public_read` applied to it, so a review this
   * caller cannot read is simply not found and the insert is refused.
   */
  it('refuses a moderation-removed review to a non-author', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA, 'Removed by moderation.', 'removed');

    const client = await signedInAs(liker.email);
    const { error } = await like(client, liker.id, review.id);

    expect(error?.code).toBe('42501');
    expect(await likesOn(review.id)).toHaveLength(0);
  });

  it('refuses a review that does not exist', async () => {
    const liker = await createUser();
    const client = await signedInAs(liker.email);

    const { error } = await like(client, liker.id, '00000000-0000-0000-0000-000000000000');

    // RLS refuses before the foreign key is ever consulted: an unreadable row
    // and an absent one are indistinguishable from outside, deliberately.
    expect(error).not.toBeNull();
    expect(['42501', '23503']).toContain(error!.code);
  });

  /**
   * **The database does not prevent a self-like, and that is the contract.**
   * An author can read their own review, so the write policy admits it.
   * Refusing it is service-layer behaviour only (`data-model.md` §5). If this
   * test ever starts failing, someone has turned a courtesy into an integrity
   * boundary and the documentation no longer describes the system.
   */
  it('does NOT prevent a self-like at the database', async () => {
    const author = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(author.email);
    const { error } = await like(client, author.id, review.id);

    expect(error).toBeNull();
    expect(await likesOn(review.id)).toHaveLength(1);
  });
});

describe('authorisation', () => {
  it('refuses a like attributed to another user', async () => {
    const author = await createUser();
    const liker = await createUser();
    const other = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    const { error } = await like(client, other.id, review.id);

    expect(error?.code).toBe('42501');
  });

  it('refuses a write from a signed-out client, and stays readable', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);
    await like(await signedInAs(liker.email), liker.id, review.id);

    const anon = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: writeError } = await anon
      .from('review_likes')
      .insert({ user_id: liker.id, review_id: review.id });
    expect(writeError).not.toBeNull();

    const { data, error } = await anon.from('review_likes').select('id').eq('review_id', review.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('grants no update, so a like cannot be re-pointed', async () => {
    const author = await createUser();
    const liker = await createUser();
    const reviewA = await writeReview(author.id, albumA);
    const reviewB = await writeReview(author.id, albumB);

    const client = await signedInAs(liker.email);
    await like(client, liker.id, reviewA.id);

    const { error } = await client
      .from('review_likes')
      .update({ review_id: reviewB.id })
      .eq('user_id', liker.id);

    expect(error).not.toBeNull();
    expect(await likesOn(reviewB.id)).toHaveLength(0);
  });
});

describe('reading liked state', () => {
  it("returns only the caller's likes, across a set of reviews", async () => {
    const author = await createUser();
    const liker = await createUser();
    const other = await createUser();
    const liked = await writeReview(author.id, albumA);
    const notLiked = await writeReview(author.id, albumB);

    await like(await signedInAs(liker.email), liker.id, liked.id);
    await like(await signedInAs(other.email), other.id, notLiked.id);

    const client = await signedInAs(liker.email);
    const { data, error } = await client
      .from('review_likes')
      .select('review_id')
      .eq('user_id', liker.id)
      .in('review_id', [liked.id, notLiked.id]);

    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.review_id)).toEqual([liked.id]);
  });
});

describe('the Activity boundary', () => {
  /**
   * Likes generate no feed events, by decision — they would dominate by volume
   * and crowd out reviews. Asserted behaviourally rather than by inspecting the
   * enum, because the path is what could regress.
   */
  it('writes no activity rows when a review is liked or unliked', async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const client = await signedInAs(liker.email);
    await like(client, liker.id, review.id);
    expect(await activityCountFor(liker.id)).toBe(0);

    await client.from('review_likes').delete().eq('user_id', liker.id).eq('review_id', review.id);
    expect(await activityCountFor(liker.id)).toBe(0);
  });

  it("leaves the review author's activity count untouched", async () => {
    const author = await createUser();
    const liker = await createUser();
    const review = await writeReview(author.id, albumA);

    const before = await activityCountFor(author.id);
    await like(await signedInAs(liker.email), liker.id, review.id);

    expect(await activityCountFor(author.id)).toBe(before);
  });
});
