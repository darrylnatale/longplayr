import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { countRows, COUNT_ONLY } from '../count';
import { getCurrentProfile } from '../profiles';

/**
 * Notifications — the directed counterpart to the feed.
 *
 * `Activity` is broadcast: things you did, shown to whoever follows you. A
 * notification is something another person did *to you*. The two carry disjoint
 * event types and neither writes the other's rows (`data-model.md` §7).
 *
 * **These are the first genuinely private rows in this schema.** Every other
 * social table is world-readable because everything user-generated is public.
 * Here the read policy is `recipient_id = auth.uid()`, and nothing in this module
 * should be written as though a notification could be read by anyone else.
 *
 * **A notification is the current existence of its source action, not a
 * historical record.** Undoing the source removes it by cascade; re-creating the
 * source produces a new one. See `architecture.md` §16.3.
 */

export type NotificationType = Database['public']['Enums']['notification_type'];

/**
 * The position of the last item on a page.
 *
 * Both halves travel together for the same reason the feed's cursor does: the
 * timestamp alone cannot separate two rows written in the same instant, and `id`
 * is what makes the ordering total.
 */
export type NotificationCursor = { before: string; beforeId: string };

/** One notification, flattened for the list. */
export type NotificationListItem = {
  id: string;
  type: NotificationType;
  createdAt: string;
  /** Null is unread. The list renders the distinction; the count reads it. */
  readAt: string | null;
  actor: { handle: string; displayName: string | null; avatarUrl: string | null };
  /** Present only on `review_liked`. The album whose review was liked. */
  album: { mbid: string; title: string } | null;
};

export type NotificationPage = {
  items: NotificationListItem[];
  nextCursor: NotificationCursor | null;
};

/** Items per page. Matches the feed: these are rows of text of similar weight. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * The embed chain, as one literal string.
 *
 * PostgREST infers the row type from the select text, so this cannot be built by
 * concatenation — the same constraint `getAlbumReviews` records.
 *
 * **Neither subject embed uses `!inner`, and that is load-bearing.** A
 * `followed` row has a null `review_like_id` and a `review_liked` row has a null
 * `follow_id`; an inner join on either would silently drop every notification of
 * the other type. The failure would look like "follows never notify" rather than
 * like a query error, which is exactly the kind of bug that survives review.
 *
 * The chain to the album is four levels deep but carries no ambiguity: every hop
 * is a single foreign key, so none of them needs naming the way an `albums` to
 * `releases` embed does.
 */
const NOTIFICATION_SELECT = `
  id, type, created_at, read_at,
  actor:profiles!notifications_actor_id_fkey(handle, display_name, avatar_url),
  review_likes(reviews(collection_entries(albums(mbid, title))))
` as const;

type EmbeddedRow = {
  id: string;
  type: NotificationType;
  created_at: string;
  read_at: string | null;
  actor: { handle: string; display_name: string | null; avatar_url: string | null } | null;
  review_likes: {
    reviews: {
      collection_entries: { albums: { mbid: string; title: string } | null } | null;
    } | null;
  } | null;
};

/**
 * Flattens one embedded row, dropping any whose actor did not come back.
 *
 * An actor is `not null` with a cascading foreign key, so a missing profile
 * means the row is mid-cascade rather than malformed. Rendering it would print a
 * notification from nobody.
 */
function toListItem(row: EmbeddedRow): NotificationListItem[] {
  if (!row.actor) return [];

  const album = row.review_likes?.reviews?.collection_entries?.albums ?? null;

  return [
    {
      id: row.id,
      type: row.type,
      createdAt: row.created_at,
      readAt: row.read_at,
      actor: {
        handle: row.actor.handle,
        displayName: row.actor.display_name,
        avatarUrl: row.actor.avatar_url,
      },
      album: album ? { mbid: album.mbid, title: album.title } : null,
    },
  ];
}

/**
 * One page of the signed-in user's notifications, newest first.
 *
 * **Keyset, not offset**, matching the feed. A notification list grows at the
 * top while it is being read, so numbered offsets re-show rows already passed;
 * and an offset page would want `count: 'exact'` on every request purely to
 * render a page number.
 *
 * **No recipient filter is written here.** RLS supplies it, and adding a
 * redundant `.eq('recipient_id', …)` would suggest the filter is the
 * application's job when the whole privacy guarantee is that it is not.
 */
export async function listNotifications(
  { limit, cursor = null }: { limit: number; cursor?: NotificationCursor | null } = {
    limit: NOTIFICATIONS_PAGE_SIZE,
  },
): Promise<NotificationPage> {
  const supabase = await createClient();

  let query = supabase
    .from('notifications')
    .select(NOTIFICATION_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  // Row-wise comparison, expressed the way PostgREST allows: strictly older, or
  // the same instant with a smaller id. `or` takes a filter string, so the two
  // halves are written out rather than composed.
  //
  // **Both values have already passed strict validation in `cursorFrom`, and
  // what arrives here is the regex match rather than the reader's text.** The
  // admitted alphabet contains no `,`, `(`, `)` or `"`, so a cursor cannot
  // become PostgREST grammar — which it previously could: `Date.parse` accepted
  // `"2020-01-01,"`, the comma reached this string as a delimiter, and the page
  // answered 500 with `PGRST100`.
  //
  // **This is validated, canonicalised interpolation. It is not a bound SQL
  // parameter, and it should not be described as one.** `or()` is the only
  // disjunction the query builder offers and it takes grammar as a string; the
  // only construct in this stack that genuinely binds a cursor is an RPC, which
  // is what the feed uses and what was judged disproportionate here.
  //
  // **The timestamp is never serialised through `Date`.** Postgres carries
  // microseconds and `toISOString()` emits milliseconds, so a round trip would
  // shift this boundary earlier and silently drop rows inside the same
  // millisecond. See `architecture.md` §16.3.
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.before},and(created_at.eq.${cursor.before},id.lt.${cursor.beforeId})`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as EmbeddedRow[];
  const items = rows.flatMap(toListItem);

  const last = rows.at(-1);
  const nextCursor =
    rows.length === limit && last ? { before: last.created_at, beforeId: last.id } : null;

  return { items, nextCursor };
}

/**
 * How many notifications the signed-in user has not read.
 *
 * Computed on read, following the same reasoning `architecture.md` §16 gives for
 * follower and following counts: no stored aggregate, so no drift, and none of
 * the four cascade paths needs a decrement.
 *
 * **Goes through `countRows`**, which is not optional — §16.2 requires it and a
 * lint rule enforces it. A raw `head: true` count would report a confident zero
 * for a relation the database could not resolve.
 *
 * Returns 0 for a signed-out visitor without querying at all.
 */
export async function unreadNotificationCount(): Promise<number> {
  const profile = await getCurrentProfile();
  if (!profile) return 0;

  const supabase = await createClient();

  return countRows(
    supabase.from('notifications').select('id', COUNT_ONLY).is('read_at', null),
    'notifications.unread',
  );
}

/**
 * Marks one notification read.
 *
 * **Idempotent, and safe to call on someone else's notification** — RLS matches
 * no row, so the update touches nothing and reports success. That is the correct
 * outcome rather than a leak: an error would confirm the row exists.
 *
 * Only `read_at` can change, and that is enforced by a column-level grant rather
 * than here. RLS decides which rows; the grant decides which columns.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);

  if (error) throw error;
}

/**
 * The notification a click should open, derived from the row.
 *
 * **Never taken from the request.** The route that marks a notification read
 * redirects to whatever this returns, so accepting a destination from the URL
 * would make it an open redirect.
 *
 * Returns null when the row is not the caller's, does not exist, or has lost the
 * subject it points at mid-cascade — the caller sends those back to the list.
 */
export async function notificationTarget(id: string): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('notifications')
    .select(
      `type,
       actor:profiles!notifications_actor_id_fkey(handle),
       review_likes(reviews(collection_entries(albums(mbid))))`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as {
    type: NotificationType;
    actor: { handle: string } | null;
    review_likes: {
      reviews: { collection_entries: { albums: { mbid: string } | null } | null } | null;
    } | null;
  };

  if (row.type === 'review_liked') {
    const mbid = row.review_likes?.reviews?.collection_entries?.albums?.mbid;
    return mbid ? `/albums/${mbid}` : null;
  }

  return row.actor ? `/${row.actor.handle}` : null;
}

/**
 * Writes one notification, tolerating the case where it already exists.
 *
 * **The unique constraints on `follow_id` and `review_like_id` are what make
 * this safe to call unconditionally.** `followUser` and `likeReview` both return
 * the pre-existing row on a duplicate and cannot tell that from a fresh insert,
 * so the caller cannot decide whether to notify. The database decides instead:
 * a repeat collides and is discarded here.
 *
 * Same shape as `activity.ts`'s `record`, deliberately — one insert, one
 * tolerated violation code, everything else thrown.
 *
 * **No `.select()`, and that is a requirement rather than a preference.** The
 * read policy is recipient-scoped, so the actor writing this row cannot read it
 * back; `INSERT … RETURNING` is refused outright. Adding a `.select()` here
 * would make every notification fail. An integration test pins it.
 */
async function record(
  recipientId: string,
  actorId: string,
  type: NotificationType,
  subject: { followId?: string; reviewLikeId?: string },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('notifications').insert({
    recipient_id: recipientId,
    actor_id: actorId,
    type,
    follow_id: subject.followId ?? null,
    review_like_id: subject.reviewLikeId ?? null,
  });

  // 23505 — the notification for this source row already exists, which is the
  // expected outcome of an idempotent retry rather than a fault.
  if (error && error.code !== '23505') throw error;
}

/** Someone followed you. */
export function recordFollowed(
  recipientId: string,
  actorId: string,
  followId: string,
): Promise<void> {
  return record(recipientId, actorId, 'followed', { followId });
}

/** Someone liked your review. */
export function recordReviewLiked(
  recipientId: string,
  actorId: string,
  reviewLikeId: string,
): Promise<void> {
  return record(recipientId, actorId, 'review_liked', { reviewLikeId });
}
