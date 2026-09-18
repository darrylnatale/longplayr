'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { deleteOwnAccount } from '@/services/auth/delete-account';

export type DeleteAccountFormState = { error?: string };

/**
 * Deletes the signed-in user's account.
 *
 * **Redirects rather than returning on success**, because there is no longer a
 * page to return to: the account this form belongs to does not exist by the
 * time the action finishes.
 */
export async function deleteAccount(
  _prevState: DeleteAccountFormState,
  formData: FormData,
): Promise<DeleteAccountFormState> {
  const result = await deleteOwnAccount(String(formData.get('confirmation') ?? ''));

  if (!result.ok) {
    if (result.error === 'unauthenticated') redirect('/login');
    if (result.error === 'no_profile') redirect('/onboarding');
    return { error: result.message };
  }

  // The layout renders the signed-in navigation from the session, which no
  // longer resolves to anybody.
  revalidatePath('/', 'layout');
  redirect('/');
}
