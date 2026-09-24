'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { requestPasswordReset } from '@/services/auth';

export type ForgotPasswordState = { sent?: boolean; fieldError?: string };

const emailSchema = z.email('Enter a valid email address.');

/**
 * Requests a reset link.
 *
 * **Reports success for any well-formed address**, whether or not it has an
 * account. The only failure a reader can see is a malformed email, because that
 * is a fact about what they typed rather than about who exists
 * (`architecture.md` §6.1).
 */
export async function requestReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = emailSchema.safeParse(String(formData.get('email') ?? ''));
  if (!parsed.success) {
    return { fieldError: parsed.error.issues[0]?.message ?? 'Enter a valid email address.' };
  }

  // Built from the request rather than from an environment variable, so a
  // preview deploy sends links back to itself instead of to production.
  //
  // **No query string, and that is a constraint rather than a style choice.**
  // Supabase appends its own `?code=` to this URL, so anything already carrying
  // a query comes back with an ampersand where the question mark should be. The
  // destination is therefore in the path — see `auth/callback/handler.ts`.
  const requestHeaders = await headers();
  const host = requestHeaders.get('host');
  const protocol = host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https';
  const redirectTo = `${protocol}://${host}/auth/callback/reset`;

  await requestPasswordReset(parsed.data, redirectTo);

  return { sent: true };
}
