/**
 * Cursor helpers for the feed.
 *
 * **In the app layer, not in `src/services/`.** These read and build web
 * addresses, and `CLAUDE.md`'s test is that a rule belongs in the service layer
 * only if a native client would need it to behave correctly — a native client
 * has no query string. This is the same placement `src/app/[handle]/pagination.ts`
 * uses, and for the same reason.
 *
 * **Two plain parameters rather than one encoded blob.** A cursor is a timestamp
 * and an id; encoding them into a single opaque token would invent a
 * serialisation format, and the only thing it would buy is hiding two values
 * that are already public.
 */

import type { FeedCursor } from '@/services/social/feed';

/** Any of the shapes `searchParams` can hand back for one key. */
type Param = string | string[] | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The cursor for this request, or null for the first page.
 *
 * **A malformed or half-supplied cursor renders the first page rather than
 * erroring.** This is the rule `pageFrom` already applies to `?page=` — "a
 * malformed page number is not worth a 404" — and the reasoning carries: a
 * cursor arrives from a link the reader did not type, so the failure mode worth
 * designing for is a truncated or stale URL, and answering that with the newest
 * page is both harmless and what the reader wanted.
 *
 * Both halves are required together. One without the other is not a cursor,
 * because the keyset comparison needs the pair.
 */
export function cursorFrom(before: Param, beforeId: Param): FeedCursor | null {
  const ts = first(before);
  const id = first(beforeId);

  if (!ts || !id) return null;
  if (!UUID.test(id)) return null;
  if (Number.isNaN(Date.parse(ts))) return null;

  return { before: ts, beforeId: id };
}

/**
 * The address of one page of the feed.
 *
 * The first page is the bare `/feed`, so it has exactly one URL rather than two
 * that render identically — the rule `relationshipPath` applies to page 1.
 */
export function feedPath(cursor: FeedCursor | null): string {
  if (!cursor) return '/feed';

  const params = new URLSearchParams({ before: cursor.before, before_id: cursor.beforeId });
  return `/feed?${params.toString()}`;
}
