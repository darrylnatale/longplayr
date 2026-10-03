'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { Container } from '@/components/Container';

/**
 * Where an unhandled render error lands - `architecture.md` section 13.1.
 *
 * **This gives the error a destination for the reader. It does not give it one
 * for the operator**, and section 13's first bullet - errors reported to Sentry
 * or equivalent, on both server and client - is still unmet. No service
 * aggregates what is logged here and nobody is alerted.
 */
export default function Error({
  error,
  reset,
}: {
  error: globalThis.Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /*
     * **The whole of the operator-facing story, and it is thin.** On a server
     * error Next.js withholds the message from the client and sends only
     * `digest`, a hash that correlates with the real stack in Vercel's function
     * logs - so this is what makes a production error findable at all.
     *
     * **An error-tracking call belongs on the next line**, once a provider is
     * chosen. Until then nothing watches this, and a client-side error on a
     * visitor's browser reaches nobody.
     */
    console.error('Unhandled render error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <Container variant="content">
      <div className="flex flex-col items-start gap-5 py-10 sm:py-16">
        <h1 className="font-serif text-3xl leading-[1.15] text-text sm:text-4xl">
          Something went wrong
        </h1>

        <p className="text-base text-text-secondary">
          This one is our fault, not yours. Trying again often works.
        </p>

        {/*
         * `reset()` re-renders the failed segment rather than reloading the
         * page, which is the right thing for the common cause: a dropped
         * database connection that the next attempt simply does not hit.
         */}
        <button
          type="button"
          onClick={reset}
          className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>

        <p className="text-sm text-text-muted">
          If it keeps happening,{' '}
          <Link
            href="/"
            className="text-accent underline decoration-accent-dim underline-offset-4 transition-colors hover:decoration-accent"
          >
            go back to the home page
          </Link>
          .
        </p>

        {/*
         * Shown rather than hidden. It is an opaque hash with nothing sensitive
         * in it, and it is the only handle somebody reporting a problem can
         * give us that ties their report to a specific log entry.
         */}
        {error.digest ? (
          <p className="font-mono text-xs text-text-faint">Reference: {error.digest}</p>
        ) : null}
      </div>
    </Container>
  );
}
