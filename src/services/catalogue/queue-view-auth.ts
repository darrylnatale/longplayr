/**
 * Authorisation for the temporary operator surface.
 *
 * Extracted from the route for the same reason `cron-auth.ts` is: getting "fails
 * closed in production" wrong is the kind of mistake that looks fine until it
 * isn't, and a rule in a route is a rule nobody tests.
 *
 * **A secret in a query parameter, deliberately, and not a privileged user.**
 * longplayr has no operator role and `CLAUDE.md` holds that there are no private
 * accounts. A privilege model introduced for a temporary page would outlive the
 * page. The weakness — secrets in URLs reach browser history, referrers and proxy
 * logs — is accepted because this surface performs no mutation whatsoever.
 * `architecture.md` §17a.
 */

export type QueueViewAuthResult = { authorised: true } | { authorised: false; reason: string };

export function authoriseQueueView(options: {
  key: string | null;
  secret: string | undefined;
  isProduction: boolean;
}): QueueViewAuthResult {
  const { key, secret, isProduction } = options;

  if (!secret || secret.trim() === '') {
    // Development runs without one so the page can be opened locally. Production
    // must never fall open: a deployment that forgot the variable would
    // otherwise publish its ingestion internals to anyone who guessed the path.
    return isProduction
      ? { authorised: false, reason: 'QUEUE_VIEW_SECRET is not configured' }
      : { authorised: true };
  }

  if (!key || key.trim() === '') return { authorised: false, reason: 'missing key' };

  return key === secret ? { authorised: true } : { authorised: false, reason: 'invalid key' };
}
