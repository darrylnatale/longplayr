'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { setPassword } from '@/services/auth';
import { passwordChoiceSchema } from '@/services/auth/password-policy';

export type ResetPasswordState = {
  error?: string;
  fieldErrors?: { password?: string; confirmPassword?: string };
};

/**
 * Sets the new password for whoever holds the recovery session.
 *
 * **Takes no identifier**, which is the security model rather than an omission:
 * the recovery link established the session, and there is no other way to reach
 * this action. An email or token parameter would be a second path to the same
 * power (`architecture.md` §6.1).
 */
export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = passwordChoiceSchema.safeParse({
    password: String(formData.get('password') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  });

  if (!parsed.success) {
    const fieldErrors: ResetPasswordState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'password' || field === 'confirmPassword') {
        fieldErrors[field] ??= issue.message;
      }
    }
    return { fieldErrors };
  }

  const result = await setPassword(parsed.data.password);

  if (!result.ok) {
    // An expired link is the common case and the reader can act on it, so it
    // sends them somewhere that says so rather than rendering an error beside
    // a form that can no longer work.
    if (result.error === 'no_recovery_session') redirect('/login?error=link_expired');
    return { error: result.message };
  }

  // They are signed in on the recovery session, so the layout's navigation
  // changes underneath them.
  revalidatePath('/', 'layout');
  redirect('/');
}
