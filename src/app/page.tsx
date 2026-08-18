import Link from 'next/link';

import { Container } from '@/components/Container';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

/**
 * Home — the front door.
 *
 * Deliberately makes **no catalogue queries**. It is an orientation surface,
 * not a discovery surface: Browse owns the catalogue wall, and duplicating a
 * grid here would put two answers to "what is in longplayr" on two pages that
 * would then drift apart.
 *
 * A signed-out visitor therefore sees no music on this page at all, which is
 * the cold-start risk docs/product-spec.md §3 names as the product's most
 * significant. Access to the catalogue is not lost — the desktop nav and the
 * mobile tab bar both carry Browse at every width — but nothing on this page
 * shows what is in it. Fixing that means adding data here, which is a product
 * decision rather than a migration one. Recorded, not taken.
 *
 * Three states, driven entirely by session and profile presence. All three are
 * unchanged from Phase 0; only their composition moved onto the tokens. The
 * one copy change is deliberate: the signed-in state previously read "the
 * catalogue arrives in the next phase", which stopped being true when Phase 1
 * completed, and a migration should not carry a false statement forward.
 */

/** Shared shape for the two account-state links, so they cannot drift apart. */
const PRIMARY =
  'rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover';
const SECONDARY =
  'rounded-sm border border-border px-5 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text';

export default async function HomePage() {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;

  return (
    <Container variant="content">
      {/*
       * Centred in the viewport rather than top-aligned.
       *
       * This page has four elements and no data, so top-aligning it leaves
       * roughly two thirds of the screen empty below the fold, which reads as
       * a page that failed to finish rather than a deliberately spare one.
       * The subtraction covers the sticky header plus main's own padding; the
       * min-height stops applying as soon as the content is taller than the
       * band, which is what happens at phone width, so nothing is ever pushed
       * under the fixed tab bar.
       */}
      <div className="flex min-h-[calc(100dvh-12rem)] flex-col justify-center py-10 sm:py-16">
        {/*
         * The pitch is editorial voice — the product speaking about what it is
         * — so it takes Newsreader. This is not the page-title case decided in
         * design-reference.md §11.7: that rule governs headings that label a
         * surface, and it explicitly leaves the serif carrying editorial
         * sentences (§12).
         */}
        <h1 className="max-w-[16ch] font-serif text-4xl leading-[1.1] text-text sm:text-5xl">
          Keep a record of what you listen to.
        </h1>

        <p className="mt-6 max-w-[52ch] text-base leading-relaxed text-text-secondary sm:text-lg">
          longplayr is a collection, not a diary. Add the albums you have heard, rate them, write
          about them, and find people whose taste runs alongside yours.
        </p>

        {user ? (
          profile ? (
            <div className="mt-10">
              <p className="text-sm text-text-muted">
                Signed in as{' '}
                <Link
                  href={`/${profile.handle}`}
                  className="text-text underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-accent"
                >
                  {profile.handle}
                </Link>
                .
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/albums" className={PRIMARY}>
                  Browse the catalogue
                </Link>
                <Link href="/search" className={SECONDARY}>
                  Search
                </Link>
              </div>
            </div>
          ) : (
            /*
             * Authenticated without a profile. Decision E makes a completed
             * profile a precondition for collecting, so this is the one thing
             * worth asking for and nothing competes with it.
             */
            <div className="mt-10 max-w-md rounded-md border border-accent-dim bg-surface p-5">
              <p className="text-sm text-text-secondary">
                Your account needs a handle before you can collect anything.
              </p>
              <Link href="/onboarding" className={`${PRIMARY} mt-4 inline-block`}>
                Choose a handle
              </Link>
            </div>
          )
        ) : (
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/signup" className={PRIMARY}>
              Create account
            </Link>
            <Link href="/login" className={SECONDARY}>
              Sign in
            </Link>
          </div>
        )}
      </div>
    </Container>
  );
}
