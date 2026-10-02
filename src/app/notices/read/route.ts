import { redirect } from 'next/navigation';

import { acknowledgeOwnStatements } from '@/services/moderation';

/**
 * Marks every notice seen, then shows them.
 *
 * **A hop rather than a write inside the page, and the reason is the pattern
 * `src/app/notifications/[id]/route.ts` already established**: a prefetched
 * route marks things read on hover, so the control is `prefetch={false}` — and
 * with the write in the page, **every future link to `/notices` had to remember
 * that flag.** A correctness property maintained by memory, on a surface that
 * discharges DSA Art 17. `architecture.md` §16.10h.
 *
 * **Now only this route needs the flag.** `/notices` holds no write at all, so
 * a link to it can prefetch freely and there is nothing left to get wrong
 * there.
 *
 * **Navigation never depends on the write**, matching §16.3 and the
 * notifications route: the update is awaited inside `try`/`catch` and the
 * redirect runs either way. **A lost write costs one stale banner. A failed
 * redirect would cost somebody the explanation they are owed**, which is not a
 * trade worth making for a badge.
 *
 * Signed-out and profile-less visitors are handled by `/notices` itself rather
 * than duplicated here — the service returns early for them, so there is
 * nothing to mark and the redirect lands on the page's own guards.
 */
export async function GET() {
  try {
    await acknowledgeOwnStatements();
  } catch (error) {
    // Swallowed deliberately and logged rather than discarded. Somebody asked
    // to read why their content was removed; failing to record that they had
    // seen it is not a reason to withhold the reason itself.
    console.error('Failed to acknowledge moderation notices', error);
  }

  redirect('/notices');
}
