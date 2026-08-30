import Link from 'next/link';

import { Avatar } from '@/components/Avatar';
import type { FollowUser } from '@/services/social';

/**
 * A person, as a row in a relationship list.
 *
 * **Rows, not a grid.** Every other list surface in this product is an artwork
 * grid, because the thing being listed is a record and the cover is how it is
 * recognised. A person is recognised by name, and 50 avatars tiled at grid
 * density would be a wall of generated placeholders — the avatar has no upload
 * path yet, so in practice every one of them is an initial on a tint.
 *
 * The whole row is the link, so the target is the row rather than the name
 * alone; a list where only the text is clickable makes the avatar look
 * decorative when it is part of the same identity.
 */

export function UserRow({ user }: { user: FollowUser }) {
  return (
    <li>
      <Link
        href={`/${user.handle}`}
        className="group flex items-center gap-4 border-b border-border py-3 transition-colors hover:bg-raised"
      >
        <Avatar
          handle={user.handle}
          displayName={user.display_name}
          url={user.avatar_url}
          px={40}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm text-text group-hover:underline">
            {user.display_name ?? user.handle}
          </span>
          {/*
           * The handle repeats only when there is a display name above it.
           * Printing "@nadia" under "nadia" is the same string twice, which the
           * profile header already avoids for the same reason.
           */}
          {user.display_name && (
            <span className="block truncate text-xs text-text-muted">@{user.handle}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** The list itself, so both destinations share one shape. */
export function UserList({ users }: { users: FollowUser[] }) {
  return (
    <ul className="border-t border-border">
      {users.map((user) => (
        <UserRow key={user.id} user={user} />
      ))}
    </ul>
  );
}
