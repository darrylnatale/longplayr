import Link from 'next/link';

import { AlbumGrid } from '@/components/AlbumGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getRecentAlbums } from '@/services/catalogue/queries';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';

/**
 * Home — the front door.
 *
 * **It now makes one catalogue query, and only one.** This page used to make
 * none deliberately, on the reasoning that Browse owns the catalogue wall and a
 * second grid here would put two answers to "what is in longplayr" on two pages
 * that would then drift apart. That reasoning is answered rather than abandoned:
 * the section below reads **the same query Browse leads with** — Recently added — at
 * a smaller caller limit, so the two cannot disagree. Home stays an orientation
 * surface — one section, no Recently added, no catalogue-size line, no
 * pagination, sorting or filtering.
 *
 * **What that comment was waiting for has arrived.** It recorded that a
 * signed-out visitor saw no music at all, which `docs/product-spec.md` §3 names
 * as the product's most significant cold-start risk, and that fixing it was a
 * product decision rather than a migration one — "recorded, not taken". It is
 * taken now: Phase 5 slice 3, defined in `product-spec.md` §6.
 *
 * **The same content for every viewer who gets any.** Signed out and signed in
 * with a profile see the identical section, and **the surface does not change
 * shape with the viewer's follow graph** — nothing here reads `follows` or a
 * follow count. That is a decision, not an omission: the follow graph is the
 * feed's subject, the feed already distinguishes _following nobody_ from
 * _following people who have done nothing_, and a second follow-conditional
 * surface would answer the same question in two places and let them drift.
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

/**
 * How many albums the front door shows.
 *
 * Twelve is fewer than Browse deliberately: this is a selection, not a wall.
 *
 * **It reads Recently added, not Popular, and that is a decision rather than a
 * detail.** `design-reference.md` §11.11: the section carrying mostly-external
 * popularity fill is no longer the lead on Browse, and the front door must not
 * lead with what Browse has demoted — otherwise the two surfaces disagree about
 * what matters. Slice 3's reasoning was that two grids on two pages must not
 * drift apart; **agreeing on the lead is the stronger form of that.**
 *
 * The paragraph this replaces explained the limit against §8.3's chart floor.
 * That reasoning was sound and no longer applies here, because this query is not
 * the chart.
 */
const HOME_SECTION_LIMIT = 12;

export default async function HomePage() {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;

  /*
   * Signed out, or signed in with a profile. **The without-a-profile state is
   * excluded deliberately**: Decision E makes a completed profile a precondition
   * for collecting, so that state asks for a handle and nothing competes with
   * it. The query is guarded rather than filtered, so that path makes no
   * catalogue request at all.
   */
  const showsDiscovery = !user || profile !== null;
  // Same two rules as Browse, at a smaller count. The surfaces read one query
  // and §6 holds they must never give different answers about what is recent.
  const albums = showsDiscovery
    ? await getRecentAlbums(HOME_SECTION_LIMIT, { onePerArtist: true, requireCover: true })
    : [];

  return (
    <>
      <Container variant="content">
        {/*
         * Centred in the viewport only when there is nothing below it.
         *
         * With four elements and no data, top-aligning leaves roughly two thirds
         * of the screen empty below the fold, which reads as a page that failed
         * to finish rather than a deliberately spare one — so the empty case
         * keeps the band it has always had. The subtraction covers the sticky
         * header plus main's own padding, and the min-height stops applying as
         * soon as the content is taller than the band, which is what happens at
         * phone width, so nothing is ever pushed under the fixed tab bar.
         *
         * **With a discovery section below it the same rule inverts**: holding
         * the pitch at full viewport height would push the albums under the
         * fold, and a cold-start surface whose content starts below the fold has
         * not solved the cold start. So the band is dropped exactly when there
         * is something to drop it for.
         */}
        <div
          className={`flex flex-col justify-center py-10 sm:py-16 ${
            albums.length > 0 ? '' : 'min-h-[calc(100dvh-12rem)]'
          }`}
        >
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

      {/*
       * A sibling container rather than a nested one, because a grid and a
       * readable text measure cannot share one width — which is the reason
       * `layout.tsx` stopped imposing a single width and left each page to
       * declare its own. The pitch keeps the 1120px reading measure; the grid
       * takes the wide one, exactly as Browse's does, so `relaxed` cells stay
       * the size that density exists to buy.
       *
       * **Guarded whole, heading included.** An empty result renders no section
       * at all — no heading, no panel, no placeholder, no zeroed count. That is
       * the rule the profile already applies to absent favourites and Browse
       * already applies to this same signal, and it is deliberately not the
       * feed's treatment: the feed explains why *your* feed is empty because
       * that is a fact about you, while an absent chart is a fact about the
       * catalogue.
       */}
      {albums.length > 0 && (
        <Container variant="wide">
          <section className="pb-4">
            <SectionHeader>Recently added</SectionHeader>
            <AlbumGrid albums={albums} density="relaxed" showCaptions />
            {/*
             * Onward into the catalogue, which Phase 5's definition of done
             * requires rather than leaves optional — a discovery surface that
             * dead-ends is the defect the notifications and sign-out cycles
             * repaired elsewhere. The signed-in pitch above already carries this
             * destination; the duplication is accepted rather than made
             * conditional, because a link that appears only for some viewers is
             * the shape this slice deliberately refused everywhere else.
             */}
            <Link
              href="/albums"
              className="mt-6 inline-block text-sm text-text-muted transition-colors hover:text-text"
            >
              Browse the catalogue
            </Link>
          </section>
        </Container>
      )}
    </>
  );
}
