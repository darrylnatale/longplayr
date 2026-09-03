import { redirect } from 'next/navigation';

import { markNotificationRead, notificationTarget } from '@/services/social/notifications';

/**
 * Opens one notification: marks it read, then sends the reader on.
 *
 * **Why a hop rather than linking straight at the target.** Clicking an unread
 * notification has to clear it, and every mutation in this codebase is a
 * form-submitted server action — which would have made each row a button and
 * cost middle-click and open-in-new-tab. A route keeps the row a real anchor and
 * still gets the write done.
 *
 * **The destination is derived from the row, never read from the request.** A
 * `?to=` parameter here would be an open redirect, and this route is exactly
 * where one would be introduced without noticing.
 *
 * **Navigation never depends on the write.** The mark-read is awaited inside
 * `try`/`catch` and the redirect runs either way. A reader who could not reach a
 * review because a `read_at` update failed would be a worse outcome than a
 * notification that stays bold, and marking read is idempotent — a lost write
 * costs one stale unread and nothing else. `architecture.md` §16.3.
 *
 * **`prefetch={false}` on the link is what keeps this honest.** A prefetched
 * route would mark notifications read on hover.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Resolved before the write: a row that is not the caller's, or has lost its
  // subject mid-cascade, returns null and there is nothing to mark.
  const target = await notificationTarget(id);

  if (!target) redirect('/notifications');

  try {
    await markNotificationRead(id);
  } catch (error) {
    // Deliberately swallowed, and logged rather than discarded. The reader asked
    // to go somewhere; failing to record that they had seen it is not a reason
    // to refuse. `src/` carries no logging infrastructure and none is introduced
    // for one call site.
    console.error('notification mark-read failed', { id, error });
  }

  redirect(target);
}
