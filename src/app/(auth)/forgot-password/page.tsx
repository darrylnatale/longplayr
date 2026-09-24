import Link from 'next/link';

import { AuthShell } from '@/components/AuthShell';

import { ForgotPasswordForm } from './ForgotPasswordForm';

/**
 * Asking for a reset link.
 *
 * **The confirmation text is deliberately conditional** — *"if that address has
 * an account"* — because the response must be identical whether or not it does.
 * `architecture.md` §6.1: a handle is public here, an email address is not.
 */

export const metadata = { title: 'Reset your password · longplayr' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="We'll email you a link to choose a new one."
    >
      <ForgotPasswordForm />

      <p className="mt-6 text-sm text-text-muted">
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
