import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Container } from '@/components/Container';
import { NotificationList } from '@/components/NotificationItem';
import { SectionHeader } from '@/components/SectionHeader';
import { getCurrentProfile, getCurrentUser } from '@/services/profiles';
import { listNotifications, NOTIFICATIONS_PAGE_SIZE } from '@/services/social/notifications';

import { cursorFrom, notificationsPath } from './pagination';

/**
 * Notifications — what other people did to you.
 *
 * **Signed out redirects to `/login`; signed in without a profile redirects to
 * `/onboarding`**, the treatment `/feed` already gives. This is not an exception
 * to the all-public model: that rule governs user-generated content, and a
 * notification is not content — it is a per-person view, and this one is
 * genuinely private to its recipient.
 *
 * **No recipient filter is passed to the query.** RLS supplies it. Writing one
 * here would imply the privacy boundary is the page's job.
 */

const INLINE_LINK =
  'text-text underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-accent';

/**
 * Two empty states, and they answer different questions.
 *
 * "Nothing here yet" answers *why is this page empty*. Running off the end of a
 * cursor answers *why is this page empty* — the list is not empty at all, the
 * reader has reached the bottom of it. The feed draws the same distinction, and
 * for the same reason: telling someone with forty notifications that they have
 * none would be simply wrong.
 */
function Empty({ endOfList }: { endOfList: boolean }) {
  if (endOfList) {
    return (
      <p className="max-w-[46ch] text-sm leading-relaxed text-text-muted">
        You&apos;ve reached the end.{' '}
        <Link href="/notifications" className={INLINE_LINK}>
          Back to top
        </Link>
      </p>
    );
  }

  return (
    <p className="max-w-[46ch] text-sm leading-relaxed text-text-muted">
      Nothing here yet. When someone follows you or likes one of your reviews, it appears here.
    </p>
  );
}

export default async function NotificationsPage({ searchParams }: PageProps<'/notifications'>) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const profile = await getCurrentProfile();
  if (!profile) redirect('/onboarding');

  const query = await searchParams;
  const cursor = cursorFrom(query.before, query.before_id);

  const { items, nextCursor } = await listNotifications({
    limit: NOTIFICATIONS_PAGE_SIZE,
    cursor,
  });

  return (
    <Container variant="content">
      <div className="py-8 sm:py-10">
        <SectionHeader>Notifications</SectionHeader>

        {items.length === 0 ? (
          // A cursor that ran out is not an empty list, so the two are told apart
          // by the cursor rather than by the row count alone.
          <Empty endOfList={cursor !== null} />
        ) : (
          <>
            <NotificationList items={items} />

            {/*
             * Forward only, matching the feed. The list grows at the top while
             * it is being read, so a numbered page is not a stable address and
             * the bare /notifications is the way back.
             */}
            {nextCursor && (
              <nav
                aria-label="Notifications pagination"
                className="mt-8 flex items-center justify-between border-t border-border pt-4"
              >
                <Link
                  href="/notifications"
                  className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text"
                >
                  Back to top
                </Link>
                <Link
                  href={notificationsPath(nextCursor)}
                  rel="next"
                  className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text"
                >
                  Older <span aria-hidden>→</span>
                </Link>
              </nav>
            )}
          </>
        )}
      </div>
    </Container>
  );
}
