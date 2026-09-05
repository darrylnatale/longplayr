import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/**
 * The following feed — a read over the materialised `Activity` table.
 *
 * **Not fan-out-on-write.** No per-follower copies exist; this is a query over
 * the follow graph, which is `architecture.md` §16's decision and is unchanged
 * here. §16.1 records why the query itself lives in a Postgres function rather
 * than in a PostgREST call: the client cannot express a subquery in a filter, so
 * the alternative passes every followee id in the URL and returns `HTTP 414`
 * somewhere past two hundred follows.
 *
 * **Everything the feed decides lives in the function, not here and not in the
 * components.** Which events qualify, whose they are, and which ones have
 * stopped being true are properties of what the feed *is*, so a second client
 * must get the same answers — `CLAUDE.md`'s test for where domain logic lives.
 * This module maps rows; it does not filter them.
 *
 * **Four event types, and there is no fifth.** `listened`, `relistened`,
 * `rated`, `reviewed`. Want to Listen additions are decided feed content
 * (`product-spec.md` §4 and §10.1) and are **not written by the Activity write
 * path yet**, so the feed cannot show them. That is a sequencing boundary
 * recorded in both of those sections, not a reversal of the decision.
 */

type FeedRow = Database['public']['Functions']['feed_activity']['Returns'][number];

export type FeedActivityType = Database['public']['Enums']['activity_type'];

/** What every feed item carries, whatever its subject. */
type FeedItemBase = {
  id: string;
  createdAt: string;
  actor: { handle: string; displayName: string | null; avatarUrl: string | null };
};

/**
 * One item as the feed renders it.
 *
 * **A discriminated union, so the album contract is preserved rather than
 * weakened.** Four of the five event types resolve to an album and carry a
 * non-nullable one; `list_created` resolves to a list and carries no album at
 * all. Making that a union rather than adding nullable fields means TypeScript
 * forces every consumer to say which case it is handling, instead of every
 * consumer defending against a null that only one type can produce.
 */
export type FeedItem =
  | (FeedItemBase & {
      type: 'listened' | 'relistened' | 'rated' | 'reviewed';
      album: { mbid: string; title: string; credit: string; hasArtwork: boolean };
      score: number | null;
      reviewBody: string | null;
    })
  | (FeedItemBase & {
      type: 'list_created';
      list: { id: string; title: string };
    });

/**
 * The position of the last item on a page.
 *
 * Both halves travel together because the keyset comparison is row-wise: the
 * timestamp alone cannot separate two events written in the same instant, and
 * `id` is what makes the ordering total.
 */
export type FeedCursor = { before: string; beforeId: string };

export type FeedPage = { items: FeedItem[]; nextCursor: FeedCursor | null };

/**
 * Items per page.
 *
 * **A presentation decision for this surface, deliberately not shared with the
 * other two.** The collection destination pages at 60 because it is a cover grid
 * whose count divides across the density ramp; the relationship lists page at 50
 * because they are rows of text. A feed row can be either a one-line event or a
 * review with several lines of prose, and the number has to be safe when a page
 * happens to be all of the second kind.
 */
export const FEED_PAGE_SIZE = 20;

/**
 * One page of the viewer's feed, newest first.
 *
 * **`limit` is required rather than defaulted**, the same reason
 * `listCollection` requires it: the bound belongs in the type, so a caller
 * cannot forget it.
 *
 * **No total is returned.** Offset pagination would want one to render "page 3
 * of 12", but that label is not a fact about a feed, and computing it would scan
 * the followed set's entire history on every request.
 */
export async function listFeed(
  viewerId: string,
  { limit, cursor = null }: { limit: number; cursor?: FeedCursor | null },
): Promise<FeedPage> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('feed_activity', {
    p_viewer: viewerId,
    p_limit: limit,
    p_before: cursor?.before,
    p_before_id: cursor?.beforeId,
  });

  if (error) throw error;

  const rows = data ?? [];
  const items = rows.flatMap(toFeedItem);

  // **The cursor is the position of the last row, and a full page means there
  // may be more.** [CORRECTED 2026-09-01]
  //
  // This previously claimed that a disqualified event could make a full page map
  // to fewer items, which was wrong in both halves: the subject filters are
  // conditions of the query rather than a filter on its results, so they run
  // before `limit`, and `toFeedItem` has no drop path — `items.length` always
  // equals `rows.length`. The two are read from `rows` anyway, because that is
  // what the cursor describes.
  //
  // A full page emits a cursor without checking whether anything follows it, so
  // an exactly-full final page still offers `Older →` and lands on the
  // end-of-feed state. That is deliberate: look-ahead was considered and not
  // adopted (`architecture.md` §16.1).
  const last = rows.at(-1);
  const nextCursor =
    rows.length === limit && last ? { before: last.created_at, beforeId: last.id } : null;

  return { items, nextCursor };
}

/**
 * One row, flattened for rendering.
 *
 * Exported and pure for the reason `toCollectionListItem` and `toFollowUser`
 * are: the integration suite proves the query — which events qualify, in what
 * order — but it cannot call this service, because `createClient` is
 * cookie-bound and there is no request scope in a test. Without this seam the
 * mapping would be the one part of the read path nothing exercises, and it is
 * where the sharp edges are: a real `0.0` score, an album with no artwork, a
 * review row on a non-review event.
 *
 * Returns an array so callers can `flatMap`, matching the two mappers above.
 */
export function toFeedItem(row: FeedRow): FeedItem[] {
  const base: FeedItemBase = {
    id: row.id,
    createdAt: row.created_at,
    actor: {
      handle: row.actor_handle,
      // Generated types cannot express nullability on a function's result
      // columns, so both of these arrive typed as `string` and are genuinely
      // nullable. Normalised here rather than defended against in every
      // component.
      displayName: row.actor_display_name ?? null,
      avatarUrl: row.actor_avatar_url ?? null,
    },
  };

  // **Branch on the type, never on whether a column looks null.** The generated
  // types claim every result column is non-nullable — `album_mbid` included —
  // and after this slice that is wrong for whichever half of the row does not
  // apply. The discriminator is the only trustworthy signal.
  if (row.type === 'list_created') {
    // The query drops a `list_created` row whose list is unreadable, so this is
    // defence against a shape that should not arrive rather than an expected
    // path. Returning nothing keeps the existing unmappable-row behaviour.
    if (row.list_id === null || row.list_id === undefined) return [];

    return [{ ...base, type: 'list_created', list: { id: row.list_id, title: row.list_title } }];
  }

  return [
    {
      ...base,
      type: row.type,
      album: {
        mbid: row.album_mbid,
        title: row.album_title,
        credit: row.album_credit,
        // Only `found` means there is an image to fetch. `absent` and `failed`
        // are different facts — one about the artwork, one about the network —
        // and both render the placeholder, which is why they collapse here and
        // nowhere else.
        hasArtwork: row.album_artwork_status === 'found',
      },
      // Compared against null explicitly so a stored `0.0` survives. A falsiness
      // check would turn the lowest real score in the product into "unrated".
      score: row.rating === null || row.rating === undefined ? null : Number(row.rating),
      reviewBody: row.review_body ?? null,
    },
  ];
}
