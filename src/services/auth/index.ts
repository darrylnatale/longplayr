import { createClient } from '@/lib/supabase/server';

import { err, ok, type Result } from '../result';

/**
 * Authentication.
 *
 * Wraps the auth provider so that route handlers and Server Actions never talk
 * to Supabase directly. Auth is the single most expensive thing in this project
 * to migrate (docs/architecture.md §6); keeping it behind one module is what
 * makes a future move a contained change rather than a rewrite.
 */

export type SignUpError = 'email_taken' | 'weak_password' | 'signup_failed';
export type SignInError = 'invalid_credentials';

export type Credentials = { email: string; password: string };

export async function signUpWithPassword(
  credentials: Credentials,
): Promise<Result<{ needsEmailConfirmation: boolean }, SignUpError>> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(credentials);

  if (error) {
    if (error.code === 'user_already_exists' || error.status === 422) {
      return err('email_taken', 'That email is already registered.');
    }
    if (error.code === 'weak_password') {
      return err('weak_password', error.message);
    }
    return err('signup_failed', error.message);
  }

  // With email confirmation enabled there is no session yet, so the caller
  // must not assume the user is signed in.
  return ok({ needsEmailConfirmation: data.session === null });
}

/**
 * Resends the signup confirmation email.
 *
 * **Deliberately tells the caller almost nothing**, and that is the design
 * rather than laziness. `architecture.md` §6: the response must be identical
 * whether or not the address has an account, because *"no account with that
 * address"* is the more useful sentence **and tells an attacker which addresses
 * are registered.** longplayr is otherwise an all-public product — but a handle
 * is public and an email address is not.
 *
 * **Rate limiting is Supabase's, not ours, and that is verified rather than
 * assumed** (`architecture.md` §18, confirmed 2026-09-15): `/auth/v1/resend`
 * carries a 60-second window per user whatever the email provider. Building an
 * anonymous-keyed limiter here would duplicate a control the vendor already
 * applies — and this codebase has none, since §8.4's limits are per *user* and
 * a resend request comes from someone who is not signed in.
 *
 * **A rate-limit rejection is swallowed for the same reason an unknown address
 * is.** Surfacing "try again in 60 seconds" to one address and nothing to
 * another would leak exactly what the identical response exists to hide.
 */
export async function resendConfirmation(email: string): Promise<void> {
  const supabase = await createClient();

  // The result is intentionally unused. Nothing the provider reports here may
  // reach the caller: not "unknown address", not "rate limited", not a
  // transport failure — each of them distinguishes one address from another.
  await supabase.auth.resend({ type: 'signup', email });
}

export async function signInWithPassword(
  credentials: Credentials,
): Promise<Result<null, SignInError>> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    // Deliberately one error for every failure mode. Distinguishing "no such
    // account" from "wrong password" tells an attacker which emails are
    // registered.
    return err('invalid_credentials', 'Those details did not match an account.');
  }

  return ok(null);
}

export async function signOutCurrentUser(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}

/**
 * Starts a password reset.
 *
 * **Tells the caller nothing, on purpose**, and for exactly the reason
 * `resendConfirmation` above does: *"no account with that address"* is the more
 * useful sentence **and tells an attacker which addresses are registered.**
 * A handle is public in this product; an email address is not.
 *
 * **A Google-authenticated account gets the same silence.** Supabase sends no
 * recovery mail for an account with no password, and distinguishing the case
 * would leak which addresses use Google. **The cost is real and recorded rather
 * than solved** (`architecture.md` §6.1): somebody who signed up with Google and
 * has forgotten that will wait for mail which never arrives.
 *
 * **Rate limiting is Supabase's.** `/auth/v1/recover` carries its own
 * per-address window, and duplicating it would mean inventing an
 * anonymous-keyed limiter this codebase does not have.
 */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const supabase = await createClient();

  // Errors are swallowed for the same reason the outcome is: surfacing
  // "too many requests" for one address and nothing for another leaks precisely
  // what the identical response exists to hide.
  await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
}

export type SetPasswordError = 'no_recovery_session' | 'weak_password' | 'update_failed';

/**
 * Sets a new password for whoever holds the current session.
 *
 * **Requires a session and takes no identifier**, which is the whole security
 * model: the recovery link is what establishes that session, and there is no
 * other way to reach this. A token in the URL, or an email parameter, would be
 * a second path to the same power.
 */
export async function setPassword(password: string): Promise<Result<null, SetPasswordError>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err('no_recovery_session', 'That reset link has expired. Request a new one.');
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    if (error.code === 'weak_password') return err('weak_password', error.message);
    // Supabase refuses a password identical to the current one on some
    // configurations. Reported as itself rather than as a generic failure.
    return err('update_failed', error.message);
  }

  return ok(null);
}

/**
 * Exchanges an emailed link's code for a session.
 *
 * **Here rather than in the route**, because `CLAUDE.md` holds that auth goes
 * through this module and never directly to Supabase — auth being the most
 * expensive thing in this project to migrate. The lint rule enforcing that
 * caught the first attempt, which put this in the route handler.
 *
 * **Returns whether it worked and nothing else.** The two reasons a code fails
 * — expired, already redeemed — call for the same action from the reader, so
 * distinguishing them would add a branch nobody can use.
 */
export async function exchangeAuthCode(code: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return !error;
}
