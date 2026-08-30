'use server';

import { revalidatePath } from 'next/cache';

import { followUser, unfollowUser } from '@/services/social';

/**
 * Profile mutations.
 *
 * Thin, like the album card's actions: authorisation, the profile precondition
 * and the self-follow refusal all live in the service layer. Nothing here talks
 * to Supabase directly.
 *
 * **No Activity row and no Notification row is written.** A follow is decided
 * to generate a notification and decided not to generate a feed event; neither
 * table exists until later slices, and inventing either here would be building
 * ahead.
 */

export type FollowActionState = { error?: string };

/**
 * Both paths revalidate the profile route rather than one address.
 *
 * A follow changes two profiles at once — the follower's following count and
 * the followee's follower count — and either may be on screen. Revalidating the
 * route covers both without the action needing to know which handles are
 * involved.
 */
function revalidateProfiles() {
  revalidatePath('/[handle]', 'page');
  revalidatePath('/[handle]/followers', 'page');
  revalidatePath('/[handle]/following', 'page');
}

export async function followAction(
  _prev: FollowActionState,
  formData: FormData,
): Promise<FollowActionState> {
  const followeeId = String(formData.get('followeeId') ?? '');
  if (!followeeId) return { error: 'Something went wrong. Reload and try again.' };

  const result = await followUser(followeeId);
  if (!result.ok) return { error: result.message };

  revalidateProfiles();
  return {};
}

export async function unfollowAction(
  _prev: FollowActionState,
  formData: FormData,
): Promise<FollowActionState> {
  const followeeId = String(formData.get('followeeId') ?? '');
  if (!followeeId) return { error: 'Something went wrong. Reload and try again.' };

  const result = await unfollowUser(followeeId);
  if (!result.ok) return { error: result.message };

  revalidateProfiles();
  return {};
}
