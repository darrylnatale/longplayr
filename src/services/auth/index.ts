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
