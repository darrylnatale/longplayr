import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { countRows, COUNT_ONLY } from '../count';
import { getCurrentProfile } from '../profiles';
import { err, ok, type Result } from '../result';

/**
 * Social — the follow graph.
 *
 * **Asymmetric.** A following B says nothing about B following A, and a
 * reciprocal follow is an ordinary second row. This was carried as `[INFERRED]`
 * in `product-spec.md` §4 and confirmed as a decision on 2026-08-30; nothing
 * here derives one direction from the other.
 *
 * **No Activity row and no Notification row is written.** A follow is decided
 * to generate a notification (`data-model.md` §7) and decided *not* to generate
 * a feed event (`product-spec.md` §4). Neither table exists, and inventing
 * either here would be building ahead.
 *
 * **No block interaction.** Follow creation and the relationship lists have no
 * block check because blocking is a later-phase feature (Phase 6). This is a
 * stated limitation rather than an oversight. When blocking arrives it is a
 * service-layer precondition on `followUser` plus a filter on the two list
 * queries — it needs nothing from this module's shape, and no abstraction has
 * been added here in anticipation of it.
 *
 * **Counts are computed on read.** No denormalised follower or following
 * counter exists, following `data-model.md` §8: no stored aggregates, so no
 * drift is possible. `relisten_count` is denormalised only because the insert
 * and the increment must be one transaction for the counter to be trustworthy;
 * that argument does not transfer to a count anyone can recompute exactly.
 */

export type Follow = Database['public']['Tables']['follows']['Row'];

/** Postgres unique-violation. Turns a double-submit into a clean outcome. */
const UNIQUE_VIOLATION = '23505';
/** Postgres foreign-key violation. The followee does not exist. */
const FOREIGN_KEY_VIOLATION = '23503';
/** PostgREST answers an offset past the end with an error, not an empty window. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

export type FollowError = 'onboarding_required' | 'self_follow' | 'not_found';

/** A person as they appear in a follower or following list. */
export type FollowUser = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type FollowUserPage = { items: FollowUser[]; total: number };

/**
 * The embedded profile, named by foreign key.
 *
 * `follows` has **two** foreign keys to `profiles`, so a bare `profiles(...)`
 * embed fails with "more than one relationship was found" — the same trap
 * `albums` → `releases` already carries, and the reason CLAUDE.md records it as
 * applying to any future table with two paths to the same relation.
 *
 * `!inner` rather than a plain embed, because the filter below must **exclude
 * the row** rather than null the embed: a suspended or banned account is hidden
 * from the public everywhere else (the profile page 404s it), and a follower
 * list is not the one place it stays visible.
 */
const FOLLOWER_EMBED =
  'created_at, person:profiles!follows_follower_id_fkey!inner(id, handle, display_name, avatar_url, status)';
const FOLLOWEE_EMBED =
  'created_at, person:profiles!follows_followee_id_fkey!inner(id, handle, display_name, avatar_url, status)';

type EmbeddedRow = {
  person: {
    id: string;
    handle: string;
    display_name: string | null;
    avatar_url: string | null;
    status: string;
  } | null;
};

/**
 * One joined row, flattened for the list.
 *
 * Exported and pure for the same reason `toCollectionListItem` is: the
 * integration suite proves the query, but it cannot call this service, because
 * `createClient` is cookie-bound and there is no request scope in a test.
 * Without this seam the mapping is the one part of the read path nothing
 * exercises.
 *
 * Returns an array so callers can `flatMap`. A follow whose person did not come
 * back cannot be rendered, and dropping it keeps the return type honest rather
 * than inventing a placeholder identity. The inner join makes that unreachable
 * in practice.
 */
export function toFollowUser(row: EmbeddedRow): FollowUser[] {
  if (!row.person) return [];
  const { id, handle, display_name, avatar_url } = row.person;
  return [{ id, handle, display_name, avatar_url }];
}

/**
 * Follows another user on behalf of the signed-in one.
 *
 * Idempotent: following someone twice returns the original row rather than
 * erroring, so a double submit or a retried request produces one row.
 *
 * Self-follow is refused here **for the message**, not for the guarantee. The
 * `follows_no_self_follow` check constraint is the integrity boundary and holds
 * regardless of what this function does.
 */
export async function followUser(followeeId: string): Promise<Result<Follow, FollowError>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return err('onboarding_required', 'Choose a handle before following people.');
  }

  if (profile.id === followeeId) {
    return err('self_follow', 'You cannot follow yourself.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('follows')
    .insert({ follower_id: profile.id, followee_id: followeeId })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from('follows')
        .select('*')
        .eq('follower_id', profile.id)
        .eq('followee_id', followeeId)
        .single();
      if (existing) return ok(existing);
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return err('not_found', 'That account does not exist.');
    }
    throw error;
  }

  return ok(data);
}

/**
 * Unfollows another user. Idempotent — unfollowing someone you do not follow
 * is a no-op rather than an error, which is what makes the control safe to
 * click twice.
 */
export async function unfollowUser(
  followeeId: string,
): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', profile.id)
    .eq('followee_id', followeeId);

  if (error) throw error;
  return ok(null);
}

/**
 * The signed-in user's follow of one person, or null.
 *
 * Returns the row rather than a boolean, matching `getMyFavourite` and
 * `getMyWantToListen`: the control only needs existence, but `created_at` is on
 * the row and a later surface that orders by it will not have to re-query.
 */
export async function getMyFollow(followeeId: string): Promise<Follow | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('follows')
    .select('*')
    .eq('follower_id', profile.id)
    .eq('followee_id', followeeId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Follower and following counts for one user.
 *
 * Both apply the **same active-profile filter as the lists**, deliberately: a
 * count of five above a list of four is a defect the reader cannot explain, and
 * the count is the navigation into the list.
 *
 * Two `head: true` counts rather than one query returning rows. Each is served
 * by its own index — `follows_followee_idx` and `follows_follower_idx` — and
 * neither transfers any row data.
 */
export async function getFollowCounts(
  userId: string,
): Promise<{ followers: number; following: number }> {
  const supabase = await createClient();

  const [followers, following] = await Promise.all([
    countRows(
      supabase
        .from('follows')
        .select('id, person:profiles!follows_follower_id_fkey!inner(status)', COUNT_ONLY)
        .eq('followee_id', userId)
        .eq('person.status', 'active'),
      'follows.followers',
    ),
    countRows(
      supabase
        .from('follows')
        .select('id, person:profiles!follows_followee_id_fkey!inner(status)', COUNT_ONLY)
        .eq('follower_id', userId)
        .eq('person.status', 'active'),
      'follows.following',
    ),
  ]);

  return { followers, following };
}

/**
 * One page of a relationship list.
 *
 * Shared by both directions because only the filter column and the embedded
 * foreign key differ. `count: 'exact'` returns the size of the whole
 * relationship rather than of this window, so the page count comes back with
 * the rows instead of costing a second round trip.
 */
async function listRelationship(
  { column, value, embed }: { column: 'follower_id' | 'followee_id'; value: string; embed: string },
  { limit, offset = 0 }: { limit: number; offset?: number },
): Promise<FollowUserPage> {
  const supabase = await createClient();

  const { data, count, error } = await supabase
    .from('follows')
    .select(embed, { count: 'exact' })
    .eq(column, value)
    .eq('person.status', 'active')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // An offset past the end is a fact about the request, not a fault: the
  // destination has to be able to ask for page 9 of a list that now has two and
  // be told so. The count does not come back on that response, so this is the
  // one case that costs a second round trip.
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const total = await countRows(
      supabase
        .from('follows')
        .select(embed, COUNT_ONLY)
        .eq(column, value)
        .eq('person.status', 'active'),
      'follows.relationship_total',
    );

    return { items: [], total };
  }

  if (error) throw error;
  return {
    items: ((data ?? []) as unknown as EmbeddedRow[]).flatMap(toFollowUser),
    total: count ?? 0,
  };
}

/** The people who follow this user, newest first. */
export function listFollowers(
  userId: string,
  options: { limit: number; offset?: number },
): Promise<FollowUserPage> {
  return listRelationship({ column: 'followee_id', value: userId, embed: FOLLOWER_EMBED }, options);
}

/** The people this user follows, newest first. */
export function listFollowing(
  userId: string,
  options: { limit: number; offset?: number },
): Promise<FollowUserPage> {
  return listRelationship({ column: 'follower_id', value: userId, embed: FOLLOWEE_EMBED }, options);
}

/**
 * Rows per page on the two relationship destinations.
 *
 * A presentation decision for these two surfaces, not a general pagination
 * constant: a list of people is rows of text, where the collection destination
 * is a cover grid whose 60 divides evenly across the density ramp. The two
 * numbers answer different questions and are deliberately not shared.
 */
export const FOLLOW_PAGE_SIZE = 50;
