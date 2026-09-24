import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { getCurrentUser } from '@/services/profiles';

import { AuthForm } from '../AuthForm';
import { signIn } from '../actions';

export const metadata = { title: 'Sign in · longplayr' };

/**
 * What an emailed link says when it no longer works.
 *
 * **Both cases get the same sentence**, because they need the same action from
 * the reader and the difference between "already used" and "expired" is not one
 * they can do anything with.
 */
const LINK_MESSAGES: Record<string, string> = {
  link_expired: 'That link has expired or has already been used. Request a new one below.',
  link_invalid: 'That link could not be read. Request a new one below.',
};

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  if (await getCurrentUser()) redirect('/');

  const error = (await searchParams).error;
  const message = typeof error === 'string' ? LINK_MESSAGES[error] : undefined;

  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          No account yet?{' '}
          <Link
            href="/signup"
            className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent"
          >
            Create one
          </Link>
        </>
      }
    >
      {message && (
        <p role="alert" className="mb-5 text-sm leading-relaxed text-danger-text">
          {message}
        </p>
      )}

      <AuthForm action={signIn} submitLabel="Sign in" />

      {/*
       * **The route back in, and it did not exist until 2026-09-24.** Somebody
       * who forgot their password could not sign in, could not delete their
       * account — that needs a session — and could not export their data.
       * `architecture.md` §6.1.
       */}
      <p className="mt-5 text-sm">
        <Link
          href="/forgot-password"
          className="text-text-muted underline decoration-border-strong underline-offset-4 transition-colors hover:text-text hover:decoration-accent"
        >
          Forgot your password?
        </Link>
      </p>
    </AuthShell>
  );
}
