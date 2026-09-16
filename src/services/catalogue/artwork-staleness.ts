/**
 * When a settled-absent cover is worth looking at again.
 *
 * **`absent` used to mean never again.** `ARTWORK_RETRYABLE` was `pending` and
 * `failed` only, and that was right while nothing outside the system could
 * change the answer — Cover Art Archive had said no, and asking twice would
 * get the same no.
 *
 * **Inviting people to upload the missing cover broke that assumption**
 * (`product-spec.md` §8.9). A reader adds art upstream and the album is never
 * looked at again, so the placeholder stays forever and the contribution is
 * invisible. **A prompt without this is worse than no prompt.**
 * `architecture.md` §7.
 */

/**
 * How long a settled-absent answer is trusted.
 *
 * **Sized against drain budget, not API quota, and the distinction is the whole
 * reason this is affordable.** Cover Art Archive has **no rate limit** (§18) —
 * unlike MusicBrainz, whose one-request-per-second cap the entire job queue
 * exists to manage. What re-checking actually spends is drain slots: roughly
 * six artwork jobs per invocation across twelve invocations, about seventy a
 * day.
 *
 * Against the ~45 albums currently absent, a 7-day window would spend about
 * nine percent of that daily budget re-asking a question whose answer has
 * almost certainly not changed. Thirty days spends about two percent.
 * **The budget protects first-time fetches from exactly the starvation the bulk
 * priority band was introduced to prevent.**
 *
 * **The cost of the long window is that a contributor waits to see their cover
 * appear.** That is accepted: a view-triggered re-check would have been
 * near-immediate but only works if they come back to the page, and this works
 * whether or not they do. **This is the one number here worth revisiting once
 * real contributions exist to measure.**
 */
export const ABSENT_RECHECK_DAYS = 30;

/** The cutoff before which a settled-absent answer is stale. */
export function absentRecheckCutoff(now: Date = new Date(), days = ABSENT_RECHECK_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Whether a settled-absent album is due another look.
 *
 * **A null timestamp counts as stale.** `artwork_updated_at` is written on
 * every attempt including absence, so a row that is `absent` with no timestamp
 * is a state the current code does not produce — and re-checking it once is far
 * cheaper than leaving an album permanently invisible to the sweep because of a
 * row that predates the column.
 */
export function isAbsentAndStale(
  artworkUpdatedAt: string | null,
  now: Date = new Date(),
  days = ABSENT_RECHECK_DAYS,
): boolean {
  if (!artworkUpdatedAt) return true;
  return new Date(artworkUpdatedAt) < absentRecheckCutoff(now, days);
}
