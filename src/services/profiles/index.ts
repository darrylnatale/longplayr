import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { err, ok, type Result } from '../result';
import { handleSchema } from './handle';

export type Profile = Database['public']['Tables']['profiles']['Row'];

export type CreateProfileError = 'invalid_handle' | 'handle_taken' | 'already_exists';

/** Postgres unique-violation. Used to turn a race into a clean outcome. */
const UNIQUE_VIOLATION = '23505';

/**
 * The signed-in auth user, or null. Cheap — reads the verified session.
 *
 * Always prefer this over reading the session directly: getUser() revalidates
 * against the auth server, whereas a session read trusts a cookie.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * The signed-in user's profile, or null if they have not chosen a handle yet.
 *
 * A null return for an authenticated user means onboarding is incomplete, not
 * that something is broken — profiles are created at handle selection.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Public profile lookup. Handles are lowercased before matching. */
export async function getProfileByHandle(handle: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('handle', handle.trim().toLowerCase())
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Whether a handle is free. Advisory only — creation is the real check. */
export async function isHandleAvailable(handle: string): Promise<boolean> {
  const parsed = handleSchema.safeParse(handle);
  if (!parsed.success) return false;
  return (await getProfileByHandle(parsed.data)) === null;
}

/**
 * Creates the signed-in user's profile, completing onboarding.
 *
 * Handle uniqueness is enforced by the database, not by a prior read: checking
 * first would leave a window where two people claim the same handle. The unique
 * violation is caught and reported as a normal outcome.
 */
export async function createProfile(input: {
  handle: string;
  displayName?: string | null;
}): Promise<Result<Profile, CreateProfileError | 'unauthenticated'>> {
  const user = await getCurrentUser();
  if (!user) return err('unauthenticated', 'You need to be signed in.');

  const parsed = handleSchema.safeParse(input.handle);
  if (!parsed.success) {
    return err('invalid_handle', parsed.error.issues[0]?.message ?? 'That handle is not valid.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      handle: parsed.data,
      display_name: input.displayName?.trim() || null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Either the handle is taken, or this user already has a profile.
      // The primary-key constraint names the latter.
      if (error.message.includes('pkey')) {
        return err('already_exists', 'You already have a profile.');
      }
      return err('handle_taken', 'That handle is already taken.');
    }
    throw error;
  }

  return ok(data);
}
