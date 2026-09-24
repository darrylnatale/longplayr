import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { exchangeAuthCode } from '@/services/auth';

/**
 * The shared body of every emailed-link callback.
 *
 * **The destination is a hard-coded argument, not a URL parameter, and that is
 * a correction rather than a preference.** The first version took `?next=` and
 * guarded it against open redirects. It could not work: **Supabase appends its
 * own `?code=` to `redirectTo`**, so a link carrying a query string came back
 * as `…/auth/callback&next=%2Freset-password` — an ampersand where the question
 * mark should be, and a destination that never parsed.
 *
 * **Found by probing a real recovery link rather than by reasoning.** The route
 * looked correct and the guard was well tested; neither told us the parameter
 * could not survive the round trip.
 *
 * **Removing the parameter removed the attack surface with it.** There is no
 * longer an open-redirect risk to guard, because a caller cannot express a
 * destination at all — one route per intent, each naming its own.
 */
export async function handleAuthCallback(
  request: NextRequest,
  destination: string,
): Promise<never> {
  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    // Already used, or truncated by a mail client. The login page says what to
    // do about it; a raw error page does not.
    redirect('/login?error=link_invalid');
  }

  const exchanged = await exchangeAuthCode(code);
  if (!exchanged) {
    // Expired or already redeemed. Both mean the same thing to the reader.
    redirect('/login?error=link_expired');
  }

  redirect(destination);
}
