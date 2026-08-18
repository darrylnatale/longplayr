import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { getCurrentUser } from '@/services/profiles';

import { AuthForm } from '../AuthForm';
import { signIn } from '../actions';

export const metadata = { title: 'Sign in · longplayr' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');

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
      <AuthForm action={signIn} submitLabel="Sign in" />
    </AuthShell>
  );
}
