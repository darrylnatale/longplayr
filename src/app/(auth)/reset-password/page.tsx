import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { getCurrentUser } from '@/services/profiles';

import { ResetPasswordForm } from './ResetPasswordForm';

/**
 * Choosing a new password.
 *
 * **Reachable only with a session, and the recovery link is what grants one.**
 * There is no token in the URL and no separate state to validate: somebody
 * arriving here without having followed a live link is sent to sign in, which
 * is also what an expired link produces. `architecture.md` §6.1.
 *
 * **A signed-in user reaching this deliberately is allowed to proceed.** The
 * page cannot distinguish a recovery session from an ordinary one, and changing
 * your own password while signed in is a legitimate thing to want — so the
 * honest behaviour is to let it happen rather than to guess.
 */

export const metadata = { title: 'Choose a new password · longplayr' };

export default async function ResetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?error=link_expired');

  return (
    <AuthShell
      title="Choose a new password"
      description="You are signed in from your reset link. Pick something you have not used here before."
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
