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

export function MobileTabBar({ youHref }: Props) {
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
      href: youHref,
      label: 'You',
      Icon: YouIcon,
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
      <ul className="grid grid-cols-3">
        {tabs.map(({ href, label, Icon, match }) => {
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
                <Icon />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
