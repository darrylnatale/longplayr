/**
 * Cursor helpers for the notifications list.
 *
 * **The same shape as `app/feed/pagination.ts`, and deliberately not shared with
 * it.** Both read a `(timestamp, id)` pair out of a query string, but they carry
 * different cursor types and different base paths, and a shared helper generic
 * over both would be a layer of indirection over twelve lines. Duplicating the
 * validation is the cheaper of the two.
 *
 * **In the app layer, not in `src/services/`.** These build web addresses, and
 * `CLAUDE.md`'s test is whether a native client would need the rule to behave
 * correctly. A native client has no query string.
 */

import type { NotificationCursor } from '@/services/social/notifications';

/** Any of the shapes `searchParams` can hand back for one key. */
type Param = string | string[] | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The cursor timestamp grammar, and it is a security boundary rather than
 * formatting.
 *
 * **This validation exists because the timestamp is interpolated into a
 * PostgREST `or()` filter, where a comma is grammar rather than data.** The
 * previous validator used `Date.parse`, which accepts `"2020-01-01,"` — that
 * reached the filter, produced `PGRST100 "failed to parse logic tree"`, and made
 * `/notifications` answer 500 for a hand-edited URL.
 *
 * The alphabet admitted here contains no `,`, `(`, `)`, `"` or whitespace, so
 * arbitrary text cannot become grammar. Anything outside it never reaches the
 * database at all.
 *
 * **The fractional part is one to six digits, or absent, because that is what
 * PostgREST actually emits.** Postgres stores microseconds and trims trailing
 * zeros, so a legitimate cursor may read `.106813`, `.10681`, `.5`, `.1`, or
 * carry no fractional part at all for a whole second. A tighter pattern would
 * reject real cursors and strand a reader on page one.
 *
 * **The offset is deliberately broader than the observed `+00:00`.** Both the
 * local and staging databases render UTC today, but hardcoding that would reject
 * every cursor if a database timezone ever changed. `Z` and `±HH:MM` add no new
 * characters.
 */
const CURSOR_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/;

function first(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The canonical timestamp for an accepted cursor, or null.
 *
 * **Returns the matched text byte for byte, and never a re-serialised `Date`.**
 * That is not a stylistic choice: Postgres and PostgREST carry **microseconds**
 * while `Date.toISOString()` emits **milliseconds**, so a round trip would move
 * the pagination boundary up to 999µs earlier. Rows older than the boundary row
 * but inside the same millisecond would then fall outside both branches of the
 * keyset predicate — present on neither page, and **silently lost**. The unit
 * tests assert byte-identity precisely so that reintroducing `toISOString()`
 * fails loudly rather than quietly dropping notifications.
 *
 * `Date` appears below **only** as a calendar predicate. A regex cannot tell
 * that 30 February is not a date, and JavaScript will happily roll it forward to
 * 2 March; comparing the parts back is what rejects it. Its serialised output is
 * discarded.
 */
function canonicalTimestamp(value: string): string | null {
  const match = CURSOR_TIMESTAMP.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);

  const parsed = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const sameDate =
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === mo - 1 &&
    parsed.getUTCDate() === d &&
    parsed.getUTCHours() === h &&
    parsed.getUTCMinutes() === mi &&
    parsed.getUTCSeconds() === s;

  // The whole match, not a rebuilt string. See above.
  return sameDate ? match[0] : null;
}

/**
 * The cursor for this request, or null for the first page.
 *
 * **A malformed or half-supplied cursor renders the first page rather than
 * erroring**, the rule the feed and `?page=` already apply: a cursor arrives
 * from a link the reader did not type, so a truncated or stale URL is the
 * failure worth designing for, and answering it with the newest page is
 * harmless. That rule was the one this surface broke, and restoring it is the
 * point of the validation above.
 *
 * **Both halves are canonicalised, and the raw query-string values are never
 * returned.** What leaves this function is the regex match in each case, so the
 * caller cannot pass user text into a filter even by accident.
 *
 * Both halves are required together — the keyset comparison needs the pair.
 */
export function cursorFrom(before: Param, beforeId: Param): NotificationCursor | null {
  const ts = first(before);
  const id = first(beforeId);

  if (!ts || !id) return null;

  const uuid = UUID.exec(id);
  if (!uuid) return null;

  const timestamp = canonicalTimestamp(ts);
  if (!timestamp) return null;

  return { before: timestamp, beforeId: uuid[0] };
}

/**
 * The address of one page of notifications.
 *
 * The first page is the bare `/notifications`, so it has one URL rather than two
 * that render identically.
 */
export function notificationsPath(cursor: NotificationCursor | null): string {
  if (!cursor) return '/notifications';

  const params = new URLSearchParams({ before: cursor.before, before_id: cursor.beforeId });
  return `/notifications?${params.toString()}`;
}
