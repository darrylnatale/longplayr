import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { toCreditedArtists } from '../catalogue/credit';

import type { AlbumArtistRow } from '../catalogue/credit';
import type { AlbumSummaryWithArtists } from '../catalogue/queries';

import { countRows, COUNT_ONLY } from '../count';
import { recordListCreated } from '../social/activity';
import { getCurrentProfile } from '../profiles';
import { err, ok, type Result } from '../result';

/**
 * Lists — user-curated collections of albums.
 *
 * **Creating a list writes one feed event; nothing else here writes any.**
 * `createList` records `list_created` and that is the whole of this module's
 * activity surface — editing, adding, removing and reordering are deliberately
 * silent, because events read live data and the feed item already shows the
 * list's current title, albums and order (`architecture.md` §16.6).
 *
 * **Still absent, and nothing here should be written as though they exist**:
 * likes and notifications, which live in `src/services/social/`, and
 * `list_updated`, whose semantics are unresolved and whose enum label is
 * deliberately not added (`architecture.md` §16.4 and §16.6).
 *
 * **`position` is always stored and always maintained contiguous, on every list,
 * ranked or not.** `is_ranked` decides whether that order is meaningful *to the
 * reader*, not whether it exists. Un-ranking preserves the order exactly and
 * re-ranking restores it, with no fallback sort — so toggling the flag can never
 * destroy curation (`data-model.md` §5).
 *
 * **Contiguity is maintained by database functions, not here.** `add`, `remove`
 * and `reorder` each need more than one statement to leave the table correct,
 * and two statements from the client leave a window — the same reasoning
 * `ensure_collection_entry` records. This module calls them; it does not
 * reimplement them.
 */

export const LISTS_PAGE_SIZE = 24;

/** How many lists a profile previews before the destination takes over. */
export const LISTS_PREVIEW_LIMIT = 5;

/** Title bounds, matching the check constraint so the UI can fail early. */
export const LIST_TITLE_MAX = 120;
export const LIST_DESCRIPTION_MAX = 2000;

export type ListSummary = {
  id: string;
  title: string;
  description: string | null;
  isRanked: boolean;
  itemCount: number;
};

export type ListItem = {
  id: string;
  position: number;
  album: AlbumSummaryWithArtists;
};

export type ListDetail = {
  id: string;
  title: string;
  description: string | null;
  isRanked: boolean;
  status: 'live' | 'removed';
  owner: { id: string; handle: string; displayName: string | null };
  items: ListItem[];
};

export type ListError =
  | 'onboarding_required'
  | 'title_required'
  | 'title_too_long'
  | 'description_too_long'
  | 'not_found'
  | 'not_ranked'
  | 'duplicate_album';

/**
 * The album shape a list renders, as one literal string.
 *
 * PostgREST infers the row type from the select text, so this cannot be built by
 * concatenation — the same constraint `getAlbumReviews` and `NOTIFICATION_SELECT`
 * record.
 */
const LIST_ITEM_SELECT = `
  id, position,
  albums(id, mbid, slug, title, display_credit, primary_type, artwork_status, first_release_date, first_release_date_precision, album_artists(position, artists(id, mbid, slug, name)))
` as const;

type ItemRow = {
  id: string;
  position: number;
  albums: {
    id: string;
    mbid: string;
    slug: string;
    title: string;
    display_credit: string;
    primary_type: Database['public']['Enums']['album_type'];
    artwork_status: Database['public']['Enums']['artwork_status'];
    first_release_date: string | null;
    first_release_date_precision: Database['public']['Enums']['date_precision'] | null;
    album_artists: AlbumArtistRow[] | null;
  } | null;
};

/**
 * Drops any item whose album did not come back — mid-cascade, not malformed.
 *
 * **`releaseYear` is derived here rather than imported.** `toSummary` in
 * `catalogue/queries` is not exported, and the embed's column list has to be a
 * literal because PostgREST infers the row type from the select text — so the
 * shape is restated rather than shared. The alternative is a second album type
 * that `AlbumGrid` would not accept.
 */
function toItem(row: ItemRow): ListItem[] {
  if (!row.albums) return [];
  const { album_artists, ...album } = row.albums;
  return [
    {
      id: row.id,
      position: row.position,
      album: {
        ...album,
        releaseYear: row.albums.first_release_date?.slice(0, 4) ?? null,
        artists: toCreditedArtists(album_artists),
      },
    },
  ];
}

/**
 * Title and description rules, exported so they can be tested without a
 * database and reused by any client.
 *
 * **These belong in the service by `CLAUDE.md`'s test**: a native client would
 * need the same rules to behave correctly, and the check constraints they mirror
 * would otherwise surface as raw Postgres errors.
 */
export function validateListFields(
  title: string,
  description: string | null,
): Result<{ title: string; description: string | null }, ListError> {
  const trimmed = title.trim();
  if (!trimmed) return err('title_required', 'Give the list a title.');
  if (trimmed.length > LIST_TITLE_MAX)
    return err('title_too_long', `Titles are at most ${LIST_TITLE_MAX} characters.`);

  const body = description?.trim() ? description.trim() : null;
  if (body && body.length > LIST_DESCRIPTION_MAX)
    return err(
      'description_too_long',
      `Descriptions are at most ${LIST_DESCRIPTION_MAX} characters.`,
    );

  return ok({ title: trimmed, description: body });
}

/** Creates a list owned by the signed-in user. */
export async function createList(input: {
  title: string;
  description?: string | null;
  isRanked?: boolean;
}): Promise<Result<{ id: string }, ListError>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle before making lists.');

  const fields = validateListFields(input.title, input.description ?? null);
  if (!fields.ok) return fields;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('lists')
    .insert({
      user_id: profile.id,
      title: fields.data.title,
      description: fields.data.description,
      is_ranked: input.isRanked ?? false,
    })
    .select('id')
    .single();

  if (error) throw error;

  // **The only list mutation that writes activity.** Editing, adding, removing
  // and reordering are deliberately silent — see `recordListCreated`.
  await recordListCreated(profile.id, data.id);

  return ok({ id: data.id });
}

/**
 * Edits a list the caller owns.
 *
 * **Toggling `is_ranked` writes nothing else.** That is the whole implementation
 * of the transition rule: positions are already maintained, so un-ranking
 * preserves them and re-ranking reveals them again. Any code that reset or
 * recomputed positions here would be the bug the decision exists to prevent.
 */
export async function updateList(
  id: string,
  input: { title: string; description?: string | null; isRanked?: boolean },
): Promise<Result<null, ListError>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const fields = validateListFields(input.title, input.description ?? null);
  if (!fields.ok) return fields;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('lists')
    .update({
      title: fields.data.title,
      description: fields.data.description,
      ...(input.isRanked === undefined ? {} : { is_ranked: input.isRanked }),
    })
    .eq('id', id)
    .select('id');

  if (error) throw error;
  // RLS matched nothing: not the caller's list, or gone.
  if (!data || data.length === 0) return err('not_found', 'That list is not available.');

  return ok(null);
}

/**
 * Deletes a list the caller owns. Hard delete, per `CLAUDE.md`; `list_items` go
 * with it by cascade. Idempotent.
 */
export async function deleteList(id: string): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();

  const { error } = await supabase.from('lists').delete().eq('id', id);
  if (error) throw error;

  return ok(null);
}

/**
 * One list with its items in position order.
 *
 * **No status filter is written here.** RLS supplies it: a removed list is
 * invisible to everyone but its author, exactly as a removed review is. Adding
 * `.eq('status', 'live')` would additionally hide it from the author.
 */
export async function getList(id: string): Promise<ListDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('lists')
    .select(
      `id, title, description, is_ranked, status,
       profiles!lists_user_id_fkey(id, handle, display_name)`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as {
    id: string;
    title: string;
    description: string | null;
    is_ranked: boolean;
    status: 'live' | 'removed';
    profiles: { id: string; handle: string; display_name: string | null } | null;
  };

  if (!row.profiles) return null;

  const { data: itemRows, error: itemError } = await supabase
    .from('list_items')
    .select(LIST_ITEM_SELECT)
    .eq('list_id', id)
    .order('position', { ascending: true });

  if (itemError) throw itemError;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isRanked: row.is_ranked,
    status: row.status,
    owner: {
      id: row.profiles.id,
      handle: row.profiles.handle,
      displayName: row.profiles.display_name,
    },
    items: ((itemRows ?? []) as unknown as ItemRow[]).flatMap(toItem),
  };
}

/**
 * A page of one user's lists, newest first.
 *
 * **Numbered, not keyset**, matching the collection and the follower lists
 * rather than the feed: a profile's lists are browsed rather than consumed
 * forward, and the total is wanted for the page count anyway.
 */
export async function listUserLists(
  userId: string,
  { page = 1, limit = LISTS_PAGE_SIZE }: { page?: number; limit?: number } = {},
): Promise<{ items: ListSummary[]; total: number }> {
  const supabase = await createClient();

  const from = (page - 1) * limit;

  const [{ data, error }, total] = await Promise.all([
    supabase
      .from('lists')
      .select('id, title, description, is_ranked, list_items(count)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1),
    countRows(
      supabase.from('lists').select('id', COUNT_ONLY).eq('user_id', userId),
      'lists.byUser',
    ),
  ]);

  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    description: string | null;
    is_ranked: boolean;
    list_items: { count: number }[];
  }[];

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      isRanked: row.is_ranked,
      itemCount: row.list_items[0]?.count ?? 0,
    })),
    total,
  };
}

/**
 * Adds an album to the end of a list.
 *
 * **Appends at `max(position) + 1` inside a database function**, so two
 * concurrent adds cannot both claim the same tail position. The unique
 * constraint is the integrity boundary for "at most once per list"; this turns
 * the resulting violation into an outcome the UI renders, the way `likeReview`
 * does.
 */
export async function addAlbumToList(
  listId: string,
  albumId: string,
): Promise<Result<null, ListError>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();

  const { error } = await supabase.rpc('add_list_item', {
    p_list_id: listId,
    p_album_id: albumId,
  });

  if (error) {
    // 23505 — already in this list.
    if (error.code === '23505') return err('duplicate_album', 'That album is already in the list.');
    // 42501 / RLS refusal, or a list that is not the caller's.
    if (error.code === '42501') return err('not_found', 'That list is not available.');
    throw error;
  }

  return ok(null);
}

/**
 * Removes an album and closes the gap it leaves.
 *
 * Idempotent — removing what is not there is a clean no-op, matching
 * `unfollowUser` and `unlikeReview`.
 */
export async function removeAlbumFromList(
  listId: string,
  albumId: string,
): Promise<Result<null, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();

  const { error } = await supabase.rpc('remove_list_item', {
    p_list_id: listId,
    p_album_id: albumId,
  });

  if (error) throw error;

  return ok(null);
}

/**
 * Moves one item to an absolute position, leaving positions contiguous.
 *
 * **Ranked-only is enforced here, and deliberately not in the database.** The
 * rule is a product one rather than an integrity one — positions are maintained
 * on every list either way — so it belongs where every client picks it up rather
 * than in `reorder_list_item`, which stays a lower-level primitive whose
 * security comes from `security invoker` plus RLS. This is the same placement
 * `likeReview` uses for refusing a self-like, and the same reason
 * `create_review_likes.sql` gives for keeping that rule out of the schema:
 * **describing a rule as enforced where it is not would be false.**
 *
 * **The check is here rather than in the UI because a second client would need
 * it** (`CLAUDE.md`, and `architecture.md` §19.3). The web interface already
 * declines to render the control on an unranked list; that is presentation, not
 * enforcement.
 *
 * **Reordering someone else's list succeeds and changes nothing.** RLS matches
 * no writable row inside the function, so the statements touch nothing and
 * report success — the same outcome `markNotificationRead` documents, and the
 * correct one: the item is publicly readable anyway, so there is no existence to
 * protect by raising. An integration test pins that nothing moves.
 */
export async function reorderListItem(
  itemId: string,
  toPosition: number,
): Promise<Result<null, ListError>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('onboarding_required', 'Choose a handle first.');

  const supabase = await createClient();

  // One query for both facts the rule needs: that the item is reachable at all,
  // and whether its list is ranked. The embed is unambiguous — `list_items` has
  // a single foreign key to `lists` — so it needs no relationship hint.
  const { data, error: lookupError } = await supabase
    .from('list_items')
    .select('id, lists(is_ranked)')
    .eq('id', itemId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  // Absent, or hidden by RLS. Indistinguishable on purpose, matching the
  // database function: saying which would disclose that the row exists.
  const list = (data as unknown as { lists: { is_ranked: boolean } | null } | null)?.lists;
  if (!list) return err('not_found', 'That list item is not available.');

  if (!list.is_ranked)
    return err('not_ranked', 'That list is not ranked, so its order is not something to arrange.');

  const { error } = await supabase.rpc('reorder_list_item', {
    p_item_id: itemId,
    p_to_position: toPosition,
  });

  if (error) {
    if (error.code === 'P0002' || error.code === '02000')
      return err('not_found', 'That list item is not available.');
    throw error;
  }

  return ok(null);
}
