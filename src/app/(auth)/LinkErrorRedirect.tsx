'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Rescues someone who followed a dead emailed link.
 *
 * **A client component, because the error arrives in a URL fragment and a
 * server can never see one.** When Supabase's verify endpoint rejects a token —
 * expired, or already used — it does not reach `/auth/callback` at all. It
 * redirects to the **Site URL** with the reason in a hash:
 * `#error=access_denied&error_code=otp_expired&…`. Everything after the `#` is
 * stripped by the browser before the request is sent.
 *
 * **So the most common failure case bypassed every server-side guard.** The
 * callback route's `link_expired` handling is real and still fires when the
 * exchange fails — but the exchange is never attempted here, because the link
 * died one hop earlier. A reader clicking yesterday's reset link landed on the
 * home page with **no explanation at all**, which is precisely the dead end
 * this cycle exists to remove.
 *
 * **Found by CI rather than by probing**, because a shell following a link sees
 * the fragment in the redirect target and a browser does not send it. The
 * end-to-end test was the only place the difference was visible.
 *
 * **Mounted on the home page alone**, since Site URL is where every rejected
 * link lands. A root-layout mount would cost a client component on every page
 * to cover a case that can only arrive at one.
 */

/** Supabase's code for a link that has expired or already been redeemed. */
const EXPIRED = 'otp_expired';

export function LinkErrorRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('error=')) return;

    const params = new URLSearchParams(hash.slice(1));
    const reason = params.get('error_code') === EXPIRED ? 'link_expired' : 'link_invalid';

    // `replace` rather than `push`: the dead link should not sit in history for
    // the back button to return to.
    router.replace(`/login?error=${reason}`);
  }, [router]);

  return null;
}
