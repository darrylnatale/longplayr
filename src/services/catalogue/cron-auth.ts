/**
 * Cron endpoint authorisation.
 *
 * The drain endpoint spends our MusicBrainz budget, so an unauthenticated
 * caller could exhaust it — and being rate-limited by MusicBrainz affects every
 * longplayr user at once, not just the caller.
 *
 * Extracted from the route so the rule itself is directly testable. Getting
 * "fails closed in production" wrong is the kind of mistake that looks fine
 * until it isn't.
 */

export type CronAuthResult = { authorised: true } | { authorised: false; reason: string };

export function authoriseCronRequest(options: {
  authorizationHeader: string | null;
  secret: string | undefined;
  isProduction: boolean;
}): CronAuthResult {
  const { authorizationHeader, secret, isProduction } = options;

  if (!secret || secret.trim() === '') {
    // No secret configured. Development runs without one so the endpoint can be
    // exercised locally; production must never fall open, because a
    // misconfigured deployment would otherwise expose it to anyone.
    return isProduction
      ? { authorised: false, reason: 'CRON_SECRET is not configured' }
      : { authorised: true };
  }

  return authorizationHeader === `Bearer ${secret}`
    ? { authorised: true }
    : { authorised: false, reason: 'invalid or missing bearer token' };
}
