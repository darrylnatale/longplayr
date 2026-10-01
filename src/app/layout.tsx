import type { Metadata } from 'next';
import { Geist, Geist_Mono, Newsreader } from 'next/font/google';
import Link from 'next/link';

import { Container } from '@/components/Container';
import { MobileTabBar } from '@/components/MobileTabBar';
import { NoticeBanner } from '@/components/NoticeBanner';
import { unreadBadgeLabel } from '@/components/NotificationItem';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';
import { unacknowledgedStatementCount } from '@/services/moderation';
import { unreadNotificationCount } from '@/services/social/notifications';

import { signOut } from './(auth)/actions';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

/**
 * Editorial face — album titles and review bodies.
 *
 * Serif for content, sans for chrome: it makes reviews feel like writing and
 * controls feel like controls (docs/design-reference.md §4).
 */
const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: 'longplayr',
  description: 'Keep a record of the albums you listen to.',
};

/**
 * Where "You" leads.
 *
 * Resolved once, server-side, and shared by the desktop nav and the mobile tab
 * bar so the two can never disagree about it.
 */
function youDestination(signedIn: boolean, handle: string | null): string {
  if (!signedIn) return '/login';
  if (!handle) return '/onboarding';
  return `/${handle}`;
}

/**
 * Desktop navigation.
 *
 * Information architecture is unchanged from Phase 0 — wordmark left, browse
 * and search beside it, account state right. Only the styling moved onto the
 * design tokens. Hidden below 768px, where MobileTabBar takes over rather than
 * duplicating these links in a cramped row.
 */
async function SiteHeader({ unread }: { unread: number }) {
  const badge = unreadBadgeLabel(unread);
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <Container variant="wide">
        <div className="flex items-center justify-between gap-6 py-3.5">
          <div className="flex items-center gap-7">
            <Link href="/" className="text-lg font-semibold tracking-tight text-text">
              longplayr
            </Link>
            {/* Hidden on mobile: these live in the bottom tab bar there. */}
            <div className="hidden items-center gap-6 md:flex">
              <Link
                href="/albums"
                className="text-sm text-text-muted transition-colors hover:text-text"
              >
                Browse
              </Link>
              <Link
                href="/search"
                className="text-sm text-text-muted transition-colors hover:text-text"
              >
                Search
              </Link>
              {/*
               * Present whether or not anyone is signed in, and signed out it
               * lands on /login — the same treatment the "You" tab already gets.
               * A nav item that appears on sign-in changes the shape of the bar
               * underneath the user.
               */}
              <Link
                href="/feed"
                className="text-sm text-text-muted transition-colors hover:text-text"
              >
                Feed
              </Link>
              {/*
               * Present whether or not anyone is signed in, for the same reason
               * Feed is: a nav item that appears on sign-in changes the shape of
               * the bar underneath the user. The count is the part that is
               * signed-in only, because a count of nobody's unread is nothing.
               */}
              <Link
                href="/notifications"
                className="flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
              >
                Notifications
                {badge && (
                  <span
                    className="tabular rounded-sm bg-accent px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none text-accent-contrast"
                    aria-label={`${unread} unread`}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            </div>
          </div>

          <div className="hidden items-center gap-5 text-sm md:flex">
            {user ? (
              <>
                {profile ? (
                  <Link
                    href={`/${profile.handle}`}
                    className="text-text-muted transition-colors hover:text-text"
                  >
                    {profile.handle}
                  </Link>
                ) : (
                  <Link
                    href="/onboarding"
                    className="text-accent transition-colors hover:text-accent-hover"
                  >
                    Finish setting up
                  </Link>
                )}
                <form action={signOut}>
                  <button
                    type="submit"
                    className="text-text-muted transition-colors hover:text-text"
                  >
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className="text-text-muted transition-colors hover:text-text">
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-sm bg-accent px-3 py-1.5 font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                >
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </Container>
    </header>
  );
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;
  const youHref = youDestination(Boolean(user), profile?.handle ?? null);

  // **Resolved once and handed to both navigations**, so the header badge and
  // the mobile tab indicator cannot disagree and the count is not queried twice
  // per render. **Signed-out visitors run no notification query at all** — the
  // guard is here rather than inside the service, so the query never happens
  // rather than happening and returning zero.
  const unread = profile ? await unreadNotificationCount() : 0;

  // **A second, separate count, and not added to the first.** `unread` leads to
  // `/notifications`; a statement of reasons leads to `/notices`, and
  // `architecture.md` §16.10 keeps the two records apart because one is
  // glanceable and the other is a retained legal notice. Signed-out visitors
  // run neither query.
  const notices = profile ? await unacknowledgedStatementCount() : 0;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <NoticeBanner count={notices} />
        <SiteHeader unread={unread} />
        {/*
         * Width is no longer imposed here. Each page declares its own through
         * Container — reading surfaces at 1120px, grid surfaces at
         * min(94vw, 1680px) — because a twelve-across grid and a readable text
         * measure cannot share one number.
         *
         * The bottom padding clears the mobile tab bar, which is fixed.
         */}
        <main className="flex-1 pb-24 pt-8 md:pb-16">{children}</main>
        <MobileTabBar youHref={youHref} unread={unread} />
      </body>
    </html>
  );
}
