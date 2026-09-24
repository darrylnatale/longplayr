import type { NextRequest } from 'next/server';

import { handleAuthCallback } from './handler';

/**
 * Where a signup confirmation link returns.
 *
 * **This route did not exist until 2026-09-24, and its absence was already
 * costing something.** With `@supabase/ssr` the client uses PKCE, so the link
 * comes back with a `code` that **must be exchanged on the server** for a
 * session. Nothing exchanged it: confirmation still marked the account
 * confirmed — that happens at Supabase's verify endpoint — but the redirect
 * landed on `/` carrying a `?code=` nobody consumed, so the user arrived
 * **signed out, on the home page, with no explanation.**
 */
export async function GET(request: NextRequest) {
  return handleAuthCallback(request, '/onboarding');
}
