import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { getCurrentProfile, getCurrentUser } from '../profiles';
import { err, ok, type Result } from '../result';
import { confirmationMatches } from './delete-confirmation';

/**
 * Deleting your own account.
 *
 * **Hard delete with a complete cascade** — a `CLAUDE.md` non-negotiable, which
 * calls an orphaned row a privacy failure. There is no grace period, no
 * soft-delete and no recovery window: an account that can be restored has not
 * been deleted. `product-spec.md` §6, Settings.
 *
 * **The delete targets `auth.users`, not `profiles`.** Deleting the profile row
 * would leave the auth user behind — able to sign in, carrying no profile, and
 * indistinguishable from someone who abandoned onboarding. The auth row is the
 * root of the cascade and the only correct target. `architecture.md` §15.1.
 *
 * **The handle is reserved by a database trigger rather than from here.** It
 * fires on the cascaded delete of the profile row, so it cannot be bypassed by
 * any deletion path — including one issued outside this application.
 */

export type DeleteAccountError =
  'unauthenticated' | 'no_profile' | 'confirmation_mismatch' | 'delete_failed';

/**
 * Deletes the signed-in user's account, once they have typed their handle.
 *
 * **Requires a profile, and that is a real precondition rather than a guard.**
 * A user mid-onboarding has an auth row and no handle, so there is nothing to
 * type and nothing to reserve. Deleting them is a legitimate thing to want and
 * is not what this path does; they are told to finish onboarding first, which
 * is the honest answer rather than a silent success.
 */
export async function deleteOwnAccount(
  confirmation: string,
): Promise<Result<{ handle: string }, DeleteAccountError>> {
  const user = await getCurrentUser();
  if (!user) return err('unauthenticated', 'You need to be signed in.');

  const profile = await getCurrentProfile();
  if (!profile) {
    return err('no_profile', 'Finish choosing a handle before deleting your account.');
  }

  if (!confirmationMatches(confirmation, profile.handle)) {
    return err('confirmation_mismatch', `Type ${profile.handle} exactly to confirm.`);
  }

  // Service-role, because no user holds the right to delete an auth row — not
  // even their own. This is the one place in the product that needs it for
  // something a user initiated.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    // Returned rather than thrown: the caller has a form to render this into,
    // and a failed deletion leaves the account exactly as it was.
    return err('delete_failed', 'Your account could not be deleted. Please try again.');
  }

  // The auth row is gone, so the session cookie now refers to nobody. Clearing
  // it is tidiness rather than security — but leaving it would show a signed-in
  // shell to someone whose account no longer exists.
  //
  // Failure here is deliberately ignored: the deletion succeeded, and reporting
  // an error would tell the user the irreversible part had not happened.
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Intentionally empty. See above.
  }

  return ok({ handle: profile.handle });
}
