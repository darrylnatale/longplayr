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
 * **Every restriction writes a statement of reasons in the same database
 * statement that applies it** (`architecture.md` §16.10d). That is why the
 * three setters go through `.rpc()` rather than `.update()`: two client calls
 * cannot be atomic, and a suspension with no explanation is exactly what DSA
 * Art 17 forbids and what §92 shipped.
 *
 * **Nothing here deletes.** Suspension and removal are reversible by design —
 * `product-spec.md` §4 calls admin content removal a soft delete — and the one
 * destructive path in the product is the account holder's own
 * (`architecture.md` §15.1).
 */

export type ModerationError =
  | 'not_admin'
  | 'not_found'
  | 'cannot_moderate_self'
  | 'cannot_moderate_admin'
  | 'statement_required';

/**
 * What a restriction owes the person it affects.
 *
 * **`statement` is the text they read, and DSA Art 17 is why it is required
 * rather than encouraged** — `architecture.md` §16.10. The check constraint on
 * `moderation_actions` refuses a restriction without one, so this is validated
 * here only to return a `Result` the admin surface can render instead of
 * throwing a database error at them.
 *
 * **Restoring needs neither.** It is not a restriction, and the schema says so.
 */
export type Reasons = { ground: string; statement: string };

const RESTORED: Reasons = {
  ground: 'reviewed again by an administrator',
  statement: 'This was restored and is visible again.',
};

function missingStatement({ ground, statement }: Reasons): boolean {
  return ground.trim().length === 0 || statement.trim().length === 0;
}

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
  reasons?: Reasons,
): Promise<Result<{ handle: string; status: UserStatus }, ModerationError>> {
  const actor = await getAdminProfile();
  if (!actor) return err('not_admin', 'You do not have access to this.');

  if (actor.id === targetId) {
    return err('cannot_moderate_self', 'You cannot change your own status here.');
  }

  const restricting = status !== 'active';
  const given = restricting ? reasons : (reasons ?? RESTORED);
  if (restricting && (!given || missingStatement(given))) {
    return err('statement_required', 'Say why. The account holder is told this.');
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

  /*
   * **One call, because two cannot hold the guarantee.** `supabase-js` has no
   * transaction, so updating the status here and inserting the statement
   * afterwards leaves a window in which the account is suspended and nothing
   * explains why — §92's defect in a new form. `architecture.md` §16.10d.
   */
  const { data: action, error } = await admin.rpc('moderate_account', {
    p_actor_id: actor.id,
    p_target_id: targetId,
    p_status: status,
    p_ground: (given ?? RESTORED).ground,
    p_statement: (given ?? RESTORED).statement,
  });
  if (error) throw error;
  if (!action) return err('not_found', 'No such account.');

  return ok({ handle: target.handle, status });
}

/** Sets a review's status. Removal hides it from everyone but its author. */
export async function setReviewStatus(
  reviewId: string,
  status: ContentStatus,
  reasons?: Reasons,
): Promise<Result<{ id: string; status: ContentStatus }, ModerationError>> {
  return moderateContent(
    status,
    reasons,
    (actorId, ground, statement) =>
      createAdminClient().rpc('moderate_review', {
        p_actor_id: actorId,
        p_review_id: reviewId,
        p_status: status,
        p_ground: ground,
        p_statement: statement,
      }),
    reviewId,
  );
}

/** Sets a list's status. Same rule as a review. */
export async function setListStatus(
  listId: string,
  status: ContentStatus,
  reasons?: Reasons,
): Promise<Result<{ id: string; status: ContentStatus }, ModerationError>> {
  return moderateContent(
    status,
    reasons,
    (actorId, ground, statement) =>
      createAdminClient().rpc('moderate_list', {
        p_actor_id: actorId,
        p_list_id: listId,
        p_status: status,
        p_ground: ground,
        p_statement: statement,
      }),
    listId,
  );
}

/**
 * The shared body of the two content actions.
 *
 * **Not generalised past these two tables.** `content_status` exists on
 * `reviews` and `lists` and nowhere else, so a wider abstraction would be
 * inventing a category the schema does not have.
 */
/**
 * The shared body of the two content actions.
 *
 * **The caller passes the call rather than a table name**, which is why this
 * takes a closure. The first version built the RPC arguments with a computed
 * key and needed `as never` to compile — **and `as never` would have silenced a
 * genuinely wrong argument name**, on a function whose whole job is to make a
 * guarantee hold. Two explicit call sites type-check against the generated
 * schema; one clever one does not.
 *
 * **Not generalised past these two.** `content_status` exists on `reviews` and
 * `lists` and nowhere else, so a wider abstraction would invent a category the
 * schema does not have.
 */
async function moderateContent(
  status: ContentStatus,
  reasons: Reasons | undefined,
  call: (
    actorId: string,
    ground: string,
    statement: string,
  ) => PromiseLike<{ data: string | null; error: { message: string } | null }>,
  id: string,
): Promise<Result<{ id: string; status: ContentStatus }, ModerationError>> {
  const actor = await getAdminProfile();
  if (!actor) return err('not_admin', 'You do not have access to this.');

  const restricting = status === 'removed';
  const given = restricting ? reasons : (reasons ?? RESTORED);
  if (restricting && (!given || missingStatement(given))) {
    return err('statement_required', 'Say why. The author is told this.');
  }

  const resolved = given ?? RESTORED;
  const { data: action, error } = await call(actor.id, resolved.ground, resolved.statement);

  if (error) throw error;
  if (!action) return err('not_found', 'No such content.');

  return ok({ id, status });
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
