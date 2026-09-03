/**
 * The counting boundary.
 *
 * Every service-layer count goes through here. See `docs/architecture.md` §16.2
 * for the contract; this file is the one place that implements it.
 *
 * **Why a boundary rather than a checked call site.** A `head: true` count is
 * issued as an HTTP `HEAD` request, and a HEAD response carries no body. The
 * Supabase client rewrites a **404 with an empty body** into a success-shaped
 * result — `error` left null, `count` null — so the idiomatic `count ?? 0`
 * reports a confident **zero** for a relation the database could not resolve.
 * A missing, renamed or **not-yet-cached** relation therefore reads as "none",
 * indistinguishable from an honest empty result. That was observed in
 * production: a profile page reported "0 followers" while `follows` was absent.
 *
 * The invariant is uniform across every count in the codebase, so it lives in
 * one place — and a boundary protects the counts that do not exist yet, where a
 * convention only protects the ones somebody remembered.
 */

/**
 * Count rows without transferring them.
 *
 * **The only `head: true` in `src/services`, and an ESLint rule keeps it that
 * way.** Callers pass this rather than writing the literal, so a raw count
 * cannot be reintroduced by habit.
 */
export const COUNT_ONLY = { count: 'exact', head: true } as const;

/**
 * The failure half of a PostgREST response.
 *
 * Declared structurally rather than imported. `PostgrestError` satisfies it,
 * and describing the shape here keeps the boundary free of any dependency on
 * postgrest-js internals — which matters because this file exists precisely
 * because that library's behaviour surprised us once.
 *
 * `hint` is optional here and required there. That is deliberate: it is the
 * most useful field when present — for a permission error Postgres puts the
 * literal fix in it — and it is absent entirely on the empty-body failures
 * described below.
 */
type CountFailure = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

/**
 * What a counting query resolves to.
 *
 * Structural, for the same reason as above, and narrow: `data` is deliberately
 * not named, because a counting query has no rows worth reading.
 */
type CountResponse = {
  count: number | null;
  error: CountFailure | null;
  status: number;
  statusText: string;
};

/** Fields worth reporting, in the order an operator wants to read them. */
function detail(error: CountFailure): string {
  // `hint` first: Postgres often puts the actionable fix there and nowhere
  // else, so a report that leads with `message` buries the useful part.
  const parts = [
    error.hint && `hint: ${error.hint}`,
    error.code && `code: ${error.code}`,
    error.details && `details: ${error.details}`,
    error.message && `message: ${error.message}`,
  ].filter(Boolean);

  return parts.length > 0 ? ` — ${parts.join(', ')}` : '';
}

/**
 * The HTTP status, and its reason phrase when there is one.
 *
 * HTTP/2 and HTTP/3 carry no reason phrase, so `statusText` is routinely empty
 * and printing it bare would produce a dangling separator.
 */
function describeStatus(status: number, statusText: string): string {
  return statusText ? `${status} ${statusText}` : `${status}`;
}

/**
 * Run a counting query and return its count, or throw.
 *
 * `label` names the operation for the operator reading the failure. It must be
 * a **static string** — never an interpolated filter value, user id or search
 * term. Diagnostics reach logs, and a label is not a place to leak a query
 * parameter.
 *
 * Throws rather than returning a `Result`: a count that cannot be obtained is a
 * genuinely unexpected failure, not an outcome any surface renders. See
 * `result.ts`.
 */
export async function countRows(query: PromiseLike<CountResponse>, label: string): Promise<number> {
  const { count, error, status, statusText } = await query;

  if (error) {
    // A HEAD response has no body, so the client cannot parse an error out of
    // one: every non-404 HEAD failure arrives with an **empty message** and no
    // code, details or hint. Rethrowing it unchanged produces a blank error
    // nobody can act on, which is why the status and label are added here. The
    // original is kept as `cause` so nothing is lost.
    throw new Error(
      `Count failed for ${label}: ${describeStatus(status, statusText)}${detail(error)}`,
      { cause: error },
    );
  }

  // **The invariant, and it is deliberately not keyed on a status code.** A
  // successful count returns a number — zero when there is genuinely nothing to
  // count. A null count with no error is meaningless on any status, and
  // enumerating the statuses that "should" produce it would encode today's
  // client behaviour as a permanent assumption. This is what the whole file
  // exists to catch.
  if (count === null) {
    throw new Error(
      `Count failed for ${label}: no count returned and no error reported ` +
        `(${describeStatus(status, statusText)}). The relation could not be resolved — ` +
        `it may be missing, renamed, or absent from the PostgREST schema cache.`,
    );
  }

  return count;
}
