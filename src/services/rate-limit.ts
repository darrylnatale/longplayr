/**
 * Recognising the database's refusal to accept another write.
 *
 * **The ceilings live in the database, not here** (`architecture.md` §14.4).
 * `follows`, `review_likes` and `list_likes` grant `insert` to `authenticated`
 * and let an owner insert freely, so a limit enforced only in the service layer
 * is bypassed by anyone posting straight to PostgREST with their own token —
 * the same shape as §14.1's hole. This module's whole job is to turn the
 * trigger's refusal into an outcome the UI can render.
 *
 * **Matched on a marker rather than on prose**, so rewording the message cannot
 * silently turn a rate limit into an unexpected exception. The same device
 * `profiles_handle_not_reserved` uses.
 */

/** Emitted by `enforce_rate_limit`. Present in every ceiling it raises. */
const MARKER = 'longplayr_rate_limited';

/** Postgres `raise_exception` — what a bare `raise` produces, and a 400. */
const RAISE_EXCEPTION = 'P0001';

/** Whether a failed write was refused by a ceiling rather than by a fault. */
export function isRateLimited(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === RAISE_EXCEPTION && Boolean(error.message?.includes(MARKER));
}

/**
 * What to tell somebody who has hit one.
 *
 * **Deliberately does not name the number.** The ceilings are set so that no
 * genuine user meets them, so anybody seeing this is either running a script —
 * who should not be handed the exact figure to pace against — or has hit a
 * limit that is wrong and should be raised rather than explained.
 */
export const RATE_LIMITED_MESSAGE = 'You are doing that too quickly. Try again in a little while.';
