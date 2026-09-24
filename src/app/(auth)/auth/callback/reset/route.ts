import type { NextRequest } from 'next/server';

import { handleAuthCallback } from '../handler';

/**
 * Where a password-recovery link returns.
 *
 * **A separate path rather than a parameter on the shared one**, because
 * Supabase appends its own `?code=` to `redirectTo` and a query string in that
 * URL comes back malformed. `handler.ts` carries the full finding.
 */
export async function GET(request: NextRequest) {
  return handleAuthCallback(request, '/reset-password');
}
