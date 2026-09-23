import { createAdminClient } from '@/lib/supabase/admin';

import { getCurrentProfile, type Profile } from '../profiles';
import { err, ok, type Result } from '../result';

/**
 * Moderation.
 *
 * **Privilege is a column, `profiles.is_admin`, settable only by SQL**
 * (`architecture.md` §14.2). There is deliberately no path in the product to
 * grant it: the first admin must be made by hand whatever else exists, and a
 * second way to become one is a second thing to attack.
 *
 * **Every write here uses the service-role client**, so RLS is not the gate —
 * this module is (`architecture.md` §5). That is stronger than an admin-shaped
 * RLS policy would be: after `20260922120000`, `status` and `is_admin` appear in
 * no grant to `authenticated` at all, so **there is no policy left to subvert**.
 *
 * **Nothing here deletes.** Suspension and removal are reversible by design —
 * `product-spec.md` §4 calls admin content removal a soft delete — and the one
 * destructive path in the product is the account holder's own
 * (`architecture.md` §15.1).
 */

export type ModerationError =
  'not_admin' | 'not_found' | 'cannot_moderate_self' | 'cannot_moderate_admin';

export type UserStatus = Profile['status'];
export type ContentStatus = 'live' | 'removed';

/**
 * The signed-in user's profile if they are an admin, otherwise null.
 *
 * **Null covers both "not signed in" and "not an admin", deliberately.** The
 * admin surface answers `notFound()` for either, because a 403 confirms the
 * route exists to someone who should not know that.
 */
export async function getAdminProfile(): Promise<Profile | null> {
  const profile = await getCurrentProfile();
  return profile?.is_admin ? profile : null;
}

/**
 * Sets another account's status.
 *
 * **Two refusals, and both are lockout protection rather than policy.** An
 * admin cannot moderate themselves, and cannot moderate another admin — so the
 * last administrator cannot be removed by accident or by a compromised session,
 * and a disagreement between admins cannot be settled by suspending each other.
 * Demoting an admin is a SQL operation, like promoting one.
 */
export async function setAccountStatus(
  targetId: string,
  status: UserStatus,
): Promise<Result<{ handle: string; status: UserStatus }, ModerationError>> {
  const actor = await getAdminProfile();
  if (!actor) return err('not_admin', 'You do not have access to this.');

  if (actor.id === targetId) {
    return err('cannot_moderate_self', 'You cannot change your own status here.');
  }

  const admin = createAdminClient();
  const { data: target, error: readError } = await admin
    .from('profiles')
    .select('id, handle, is_admin')
    .eq('id', targetId)
    .maybeSingle();

  if (readError) throw readError;
  if (!target) return err('not_found', 'No such account.');
  if (target.is_admin) {
    return err('cannot_moderate_admin', 'Administrators cannot be moderated from here.');
  }

  const { error } = await admin.from('profiles').update({ status }).eq('id', targetId);
  if (error) throw error;

  return ok({ handle: target.handle, status });
}

/** Sets a review's status. Removal hides it from everyone but its author. */
export async function setReviewStatus(
  reviewId: string,
  status: ContentStatus,
): Promise<Result<{ id: string; status: ContentStatus }, ModerationError>> {
  return setContentStatus('reviews', reviewId, status);
}

/** Sets a list's status. Same rule as a review. */
export async function setListStatus(
  listId: string,
  status: ContentStatus,
): Promise<Result<{ id: string; status: ContentStatus }, ModerationError>> {
  return setContentStatus('lists', listId, status);
}

/**
 * The shared body of the two content actions.
 *
 * **Not generalised past these two tables.** `content_status` exists on
 * `reviews` and `lists` and nowhere else, so a wider abstraction would be
 * inventing a category the schema does not have.
 */
async function setContentStatus(
  table: 'reviews' | 'lists',
  id: string,
  status: ContentStatus,
): Promise<Result<{ id: string; status: ContentStatus }, ModerationError>> {
  const actor = await getAdminProfile();
  if (!actor) return err('not_admin', 'You do not have access to this.');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from(table)
    .update({ status })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) return err('not_found', 'No such content.');

  return ok({ id: data.id, status });
}

/** One row of the accounts list. */
export type ModeratableAccount = {
  id: string;
  handle: string;
  displayName: string | null;
  status: UserStatus;
  isAdmin: boolean;
};

/**
 * Every account, for the admin surface.
 *
 * **Unpaginated, and that is a deliberate limit rather than an oversight.** The
 * product holds a handful of profiles; a page control on a list of four would
 * be ceremony. It needs one before this surface is useful at scale, which is
 * the same threshold at which a reports queue replaces browsing accounts by
 * hand (`development-plan.md` Phase 6, slice 3).
 */
export async function listAccounts(): Promise<ModeratableAccount[]> {
  const actor = await getAdminProfile();
  if (!actor) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, handle, display_name, status, is_admin')
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    status: row.status,
    isAdmin: row.is_admin,
  }));
}
