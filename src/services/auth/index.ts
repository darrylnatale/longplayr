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
