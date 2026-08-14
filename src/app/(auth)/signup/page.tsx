import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/services/profiles';

import { AuthForm } from '../AuthForm';
import { signUp } from '../actions';

export const metadata = { title: 'Create account · longplayr' };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect('/');

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Create your account</h1>

      <AuthForm
        action={signUp}
        submitLabel="Create account"
        passwordHint="At least 8 characters."
      />

      <p className="mt-6 text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
