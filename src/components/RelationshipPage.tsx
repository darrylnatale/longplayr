import Link from 'next/link';

import { Avatar } from '@/components/Avatar';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { UserList } from '@/components/UserRow';
import type { FollowUser } from '@/services/social';

/**
 * The shared body of the two relationship destinations.
 *
 * `/<handle>/followers` and `/<handle>/following` are **distinct destinations**
 * rather than one page with tabs (decided 2026-08-30): they hold different sets
 * and each profile count links to exactly one of them, which a combined address
 * could not express.
 *
 * They differ only in their title, their empty state and which query filled
 * them, so the shell lives here once. Each route owns its own data fetching —
 * this takes rows as props and touches no client.
 *
 * **`content`, not `wide`.** Every other destination in the product is a cover
 * grid and takes the wide container for grid geometry. This is rows of text
 * about people, so it takes the reading measure; stretching a 40px avatar and a
 * name across 1680px would leave the name orphaned from its row.
 */

type Props = {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  title: string;
  users: FollowUser[];
  total: number;
  page: number;
  totalPages: number;
  emptyMessage: string;
  /** Builds the address of page n of this same list. */
  href: (page: number) => string;
};

/**
 * Who this list belongs to, and the way back.
 *
 * The same strip the collection destination uses, and for the same reason:
 * without it the page is a list of names that has lost its subject, which is
 * fine when you arrived from the profile and wrong when someone sent you the
 * link.
 */
function IdentityStrip({
  handle,
  displayName,
  avatarUrl,
}: {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}) {
  return (
    <Link
      href={`/${handle}`}
      className="group inline-flex items-center gap-3 text-sm text-text-muted transition-colors hover:text-text"
    >
      <Avatar handle={handle} displayName={displayName} url={avatarUrl} px={32} />
      <span>
        <span className="text-text">{displayName ?? handle}</span>
        {displayName && <span className="ml-2">@{handle}</span>}
      </span>
    </Link>
  );
}

/**
 * Previous and Next rather than Newer and Older.
 *
 * The collection destination uses the time-flavoured pair because its axis is
 * when albums were added and the reader is moving through a history. A
 * relationship list is ordered newest first too, but the reader is looking for
 * a *person*, not scrubbing a timeline — "Older followers" describes the
 * ordering rather than what the reader is doing, so the neutral pair is
 * honest where the other would be decorative.
 *
 * Renders nothing when everything fits on one page.
 */
function Pagination({
  page,
  totalPages,
  href,
  label,
}: {
  page: number;
  totalPages: number;
  href: (page: number) => string;
  label: string;
}) {
  if (totalPages <= 1) return null;

  const link = 'rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text';

  return (
    <nav
      aria-label={label}
      className="mt-8 flex items-center justify-between border-t border-border pt-4"
    >
      <div className="flex-1">
        {page > 1 && (
          <Link href={href(page - 1)} rel="prev" className={link}>
            <span aria-hidden>←</span> Previous
          </Link>
        )}
      </div>

      <p className="tabular text-xs text-text-faint">
        Page {page} of {totalPages}
      </p>

      <div className="flex flex-1 justify-end">
        {page < totalPages && (
          <Link href={href(page + 1)} rel="next" className={link}>
            Next <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

export function RelationshipPage({
  handle,
  displayName,
  avatarUrl,
  title,
  users,
  total,
  page,
  totalPages,
  emptyMessage,
  href,
}: Props) {
  return (
    <Container variant="content">
      <header className="border-b border-border pb-6">
        <IdentityStrip handle={handle} displayName={displayName} avatarUrl={avatarUrl} />
        <h1 className="mt-4 text-2xl leading-tight text-text">{title}</h1>
      </header>

      <section className="mt-8">
        <SectionHeader trailing={total > 0 ? <span className="tabular">{total}</span> : undefined}>
          {title}
        </SectionHeader>

        {total === 0 ? (
          /*
           * A deliberate panel rather than a stray grey line, matching the
           * empty collection. An unpopulated relationship list is the common
           * case on a young product and will be seen constantly.
           */
          <div className="rounded-md border border-dashed border-border px-6 py-14 text-center">
            <p className="font-serif text-lg text-text-secondary">{emptyMessage}</p>
          </div>
        ) : (
          <UserList users={users} />
        )}

        <Pagination page={page} totalPages={totalPages} href={href} label={`${title} pages`} />
      </section>
    </Container>
  );
}
