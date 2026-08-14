import Link from 'next/link';

import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

export default async function HomePage() {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;

  return (
    <div className="mx-auto max-w-xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight">longplayr</h1>
      <p className="mt-3 text-muted">
        Keep a record of the albums you listen to. Rate them, write about them, and see what other
        people are hearing.
      </p>

      {user ? (
        profile ? (
          <p className="mt-8 text-sm text-muted">
            Signed in as{' '}
            <Link
              href={`/${profile.handle}`}
              className="text-foreground underline underline-offset-4"
            >
              {profile.handle}
            </Link>
            . The catalogue arrives in the next phase.
          </p>
        ) : (
          <p className="mt-8 text-sm text-muted">
            <Link href="/onboarding" className="text-foreground underline underline-offset-4">
              Choose a handle
            </Link>{' '}
            to finish setting up your account.
          </p>
        )
      ) : (
        <div className="mt-8 flex gap-3">
          <Link
            href="/signup"
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:border-muted"
          >
            Create account
          </Link>
          <Link
            href="/login"
            className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      )}
    </div>
  );
}
