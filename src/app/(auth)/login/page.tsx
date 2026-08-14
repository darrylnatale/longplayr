import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/services/profiles';

import { AuthForm } from '../AuthForm';
import { signIn } from '../actions';

export const metadata = { title: 'Sign in · longplayr' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Sign in</h1>

      <AuthForm action={signIn} submitLabel="Sign in" />

      <p className="mt-6 text-sm text-muted">
        No account yet?{' '}
        <Link href="/signup" className="text-foreground underline underline-offset-4">
          Create one
        </Link>
      </p>
    </div>
  );
}
