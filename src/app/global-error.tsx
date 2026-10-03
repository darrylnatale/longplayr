'use client';

import { useEffect } from 'react';

/**
 * The last resort - `architecture.md` section 13.1.
 *
 * **This fires only when the root layout itself throws**, which `error.tsx`
 * cannot catch because it renders inside that layout. The root layout awaits
 * the current user, their profile, an unread notification count and an
 * unacknowledged statement count, so a database outage reaches here rather
 * than the ordinary error page.
 *
 * **Every style is inline, and that is not laziness.** Replacing the root
 * layout means `globals.css` is not linked, so the semantic tokens do not
 * resolve. On a dark-ground design a missing `--color-bg` yields black text on
 * white - a page that looks broken on top of reporting a break. The ramp
 * values are therefore hardcoded here, and this is the one file in the project
 * where that is correct.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: globalThis.Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root layout error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    // `html` and `body` are required: this replaces the root layout entirely.
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          // --ink-950 and --ink-50, inlined. See the note above.
          background: '#0f0e0d',
          color: '#f4f1ee',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <main style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: '0 0 1rem' }}>
            longplayr is having a problem
          </h1>

          <p style={{ margin: '0 0 1.5rem', color: '#c7c1bc', lineHeight: 1.6 }}>
            Something failed before the page could load. This is our fault, not yours.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              // --brass-500 on --ink-950.
              background: '#c9a227',
              color: '#0f0e0d',
              border: 0,
              borderRadius: '2px',
              padding: '0.6rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>

          {error.digest ? (
            <p
              style={{
                margin: '1.5rem 0 0',
                fontSize: '0.75rem',
                color: '#554e49',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
