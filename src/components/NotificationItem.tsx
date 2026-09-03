import Link from 'next/link';

import { Avatar } from '@/components/Avatar';
import { formatRelativeTime } from '@/components/FeedItem';
import type { NotificationListItem } from '@/services/social/notifications';

/**
 * One notification, as a row.
 *
 * **Rows, not a grid, and the whole row is the link** — the shape `UserRow`
 * established for the relationship lists, and for the same reason: the thing
 * being listed is a person doing something, recognised by name rather than by
 * cover art.
 *
 * **The link goes to `/notifications/[id]`, not straight to the target.** That
 * route marks the notification read and then redirects to a destination it
 * derives from the row itself. Two properties follow, and both are deliberate:
 *
 * - It is a real anchor, so middle-click and open-in-new-tab behave normally. A
 *   form-submitted button would have lost that.
 * - **`prefetch` is off.** Next prefetches page routes on hover; a prefetched
 *   notification would be marked read without anyone clicking it.
 *
 * **Unread is carried by weight and a marker, not by colour alone.** Colour on
 * its own is not available to every reader, and the accent is already spoken for
 * as the interactive tint.
 */

/**
 * What the row says, without the name in front of it.
 *
 * Pure and exported so it can be tested in isolation, the same reason
 * `FeedItem` exports `compactCopy`: the integration suite proves which
 * notifications come back, never how they read.
 *
 * **The album is dropped rather than guessed at when the embed came back
 * empty.** A review whose album vanished mid-cascade would otherwise print
 * "your review of undefined".
 */
export function notificationCopy(
  type: NotificationListItem['type'],
  albumTitle: string | null,
): string {
  if (type === 'followed') return 'followed you';
  return albumTitle ? `liked your review of ${albumTitle}` : 'liked your review';
}

/**
 * The badge label for an unread count.
 *
 * Capped so the navigation does not change width as the number grows — past
 * nine the exact figure has stopped being the point. Returns null below one, so
 * the caller renders nothing rather than a zero.
 */
export function unreadBadgeLabel(count: number): string | null {
  if (count < 1) return null;
  return count > 9 ? '9+' : String(count);
}

export function NotificationItem({ item }: { item: NotificationListItem }) {
  const unread = item.readAt === null;
  const name = item.actor.displayName ?? item.actor.handle;

  return (
    <li>
      <Link
        href={`/notifications/${item.id}`}
        prefetch={false}
        className="group flex items-start gap-4 border-b border-border py-3.5 transition-colors hover:bg-raised"
      >
        {/*
         * The marker column keeps its width whether or not a dot is drawn, so a
         * list of mixed states does not ragged-edge down the left.
         */}
        <span aria-hidden className="mt-2 w-1.5 shrink-0">
          {unread && <span className="block h-1.5 w-1.5 rounded-full bg-accent" />}
        </span>

        <Avatar
          handle={item.actor.handle}
          displayName={item.actor.displayName}
          url={item.actor.avatarUrl}
          px={40}
        />

        <span className="min-w-0 flex-1">
          <span
            className={`block text-sm ${unread ? 'font-medium text-text' : 'text-text-secondary'}`}
          >
            <span className="group-hover:underline">{name}</span>{' '}
            {notificationCopy(item.type, item.album?.title ?? null)}
          </span>
          <span className="mt-0.5 block text-xs text-text-faint">
            {formatRelativeTime(item.createdAt)}
          </span>
        </span>

        {unread && <span className="sr-only">Unread</span>}
      </Link>
    </li>
  );
}

export function NotificationList({ items }: { items: NotificationListItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <NotificationItem key={item.id} item={item} />
      ))}
    </ul>
  );
}
