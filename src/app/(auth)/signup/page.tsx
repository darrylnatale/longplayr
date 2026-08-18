import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { getCurrentUser } from '@/services/profiles';

import { AuthForm } from '../AuthForm';
import { signUp } from '../actions';

export const metadata = { title: 'Create account · longplayr' };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect('/');

  return (
    <AuthShell
      title="Create your account"
      description="One account, then choose a handle. Everything you add is public."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent"
          >
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm
        action={signUp}
        submitLabel="Create account"
        passwordHint="At least 8 characters."
      />
    </AuthShell>
  );
}
