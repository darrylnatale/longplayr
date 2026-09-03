'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Primary navigation below 768px.
 *
 * A bottom tab bar rather than a hamburger drawer: longplayr is browse-heavy,
 * and burying Browse and Search behind a menu tax puts the two most common
 * actions one tap further away on the device where taps cost most. The desktop
 * nav keeps its own structure — this replaces it, it does not mirror it.
 *
 * **"You" is a destination, not an authentication state.** Its label never
 * changes; only where it leads does. A tab whose name changes underneath the
 * user is a tab they have to re-read every time, and it makes the bar's shape
 * depend on session state.
 */

type Props = {
  /** Resolved server-side: login, onboarding, or the user's profile. */
  youHref: string;
  /** Unread notifications. Only whether it is above zero is used here. */
  unread: number;
};

const ICON = 'h-5 w-5';

function BrowseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={ICON}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function FeedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={ICON}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M4 6h16" strokeLinecap="round" />
      <path d="M4 12h16" strokeLinecap="round" />
      <path d="M4 18h10" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={ICON}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function YouIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={ICON}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
    </svg>
  );
}

export function MobileTabBar({ youHref, unread }: Props) {
  const pathname = usePathname();

  const tabs = [
    {
      href: '/albums',
      label: 'Browse',
      Icon: BrowseIcon,
      match: (p: string) => p.startsWith('/albums'),
    },
    {
      href: '/search',
      label: 'Search',
      Icon: SearchIcon,
      match: (p: string) => p.startsWith('/search'),
    },
    {
      href: '/feed',
      label: 'Feed',
      Icon: FeedIcon,
      match: (p: string) => p.startsWith('/feed'),
    },
    {
      href: youHref,
      label: 'You',
      Icon: YouIcon,
      // The unread indicator rides here rather than on a fifth tab. Four tabs
      // is the locked shape; a fifth would narrow every one of them, and
      // notifications are reachable from the personal surface on mobile.
      // `architecture.md` §16.3.
      indicate: unread > 0,
      // Everything that is "about you" lights the same tab, wherever it leads.
      match: (p: string) =>
        p === youHref ||
        p.startsWith('/onboarding') ||
        p.startsWith('/login') ||
        p.startsWith('/signup'),
    },
  ];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-4">
        {tabs.map(({ href, label, Icon, match, indicate }) => {
          const active = match(pathname);
          return (
            <li key={label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[0.7rem] ${
                  active ? 'text-accent' : 'text-text-muted'
                }`}
              >
                {/*
                 * The dot is positioned on the icon rather than added as a
                 * sibling, so the tab's height and the row's grid are
                 * untouched — the count itself stays on the desktop nav, where
                 * there is room for a number.
                 */}
                <span className="relative">
                  <Icon />
                  {indicate && (
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent"
                    />
                  )}
                </span>
                {label}
                {indicate && <span className="sr-only">, unread notifications</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
