import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

import { getCurrentProfile } from '../profiles';
import { err, ok, type Result } from '../result';

/**
 * The collection service.
 *
 * Phase 2's write surface. Four rules hold across everything here:
 *
 * 1. **One path creates a collection entry.** `ensureEntry` wraps the
 *    `ensure_collection_entry` database function, and the explicit add plus
 *    every implicit one — rating, liking, reviewing, relistening — goes through
 *    it. The Want to Listen clearing rule therefore exists once.
 * 2. **Creating an entry creates no event.** Activity belongs to the social
 *    phase. An implicit add must never announce a listen the user did not
 *    claim: they rated a record, they did not say they heard it.
 * 3. **A completed profile is required to author anything** (decision E). The
 *    foreign keys enforce it, and every mutation checks it first so the caller
 *    gets an outcome rather than a constraint violation.
 * 4. **Ownership is checked in application code**, not left to RLS
 *    (docs/architecture.md §5). RLS is the backstop.
 *
 * Expected failures return `Result`. Genuine faults still throw.
 */

export type CollectionEntry = Database['public']['Tables']['collection_entries']['Row'];
export type Review = Database['public']['Tables']['reviews']['Row'];
export type FavouriteAlbum = Database['public']['Tables']['favourite_albums']['Row'];
export type WantToListenRow = Database['public']['Tables']['want_to_listen']['Row'];

export type MutationError =
  | 'onboarding_required'
  | 'not_found'
  | 'invalid_rating'
  | 'invalid_review'
  | 'favourites_full'
  | 'not_owner';

/** Postgres error code we turn into an outcome rather than an exception. */
const CHECK_VIOLATION = '23514';

/** The maximum number of pinned favourites. Also enforced by the schema. */
export const MAX_FAVOURITES = 10;

/**
 * The acting user's profile id.
 *
 * A completed profile is the precondition for authoring anything, so this is
 * the first line of every mutation. Returning the outcome rather than throwing
 * keeps "you haven't chosen a handle yet" a thing the UI can render.
 */
async function requireProfileId(): Promise<Result<string, 'onboarding_required'>> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return err('onboarding_required', 'Choose a handle before adding to your collection.');
  }
  return ok(profile.id);
}

/**
 * Rating validation.
 *
 * 0.0-10.0 to one decimal. `0.0` is a real score and must survive; only `null`
 * means unrated, which is why this checks for null explicitly rather than
 * leaning on falsiness — `if (!rating)` would silently discard every zero.
 */
export function isValidRating(rating: number | null): boolean {
  if (rating === null) return true;
  if (!Number.isFinite(rating)) return false;
  if (rating < 0 || rating > 10) return false;
  return Math.round(rating * 10) === rating * 10;
}

/**
 * Creates the entry if it does not exist, and clears Want to Listen.
 *
 * Delegates to the database function so the upsert and the clear are atomic —
 * two round-trips would leave a window in which a collected album is still on
 * the wishlist. `listened_on` applies only on creation; re-running this for an
 * album already held never rewrites a date the user set.
 *
 * **Creates no activity event**, by design.
 */
export async function ensureEntry(
  albumId: string,
  listenedOn?: string | null,
): Promise<Result<CollectionEntry, 'onboarding_required' | 'not_found'>> {
  const profileId = await requireProfileId();
  if (!profileId.ok) return profileId;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ensure_collection_entry', {
    p_user_id: profileId.data,
    p_album_id: albumId,
    p_listened_on: listenedOn ?? undefined,
  });

  if (error) {
    // A foreign-key violation here means the album does not exist. That is an
    // outcome a caller can render, not a fault.
    if (error.code === '23503') return err('not_found', 'That album is not in the catalogue.');
    throw error;
  }

  return ok(data);
}

/** The signed-in user's entry for an album, or null. */
export async function getMyEntry(albumId: string): Promise<CollectionEntry | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('collection_entries')
    .select('*')
    .eq('user_id', profile.id)
    .eq('album_id', albumId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Everything the album page needs to render personal state, in one read.
 *
 * The review comes back whole rather than as a boolean. Two things need it: the
 * removal warning, which has to know whether there is writing to lose before
 * offering a control that says only "Remove", and the editor, which has to
 * prefill with what is already there rather than making someone retype it.
 */
export async function getMyCollectionState(albumId: string): Promise<{
  entry: CollectionEntry | null;
  /** The caller's own review, body included so the editor can prefill it. */
  review: { id: string; body: string; status: string; updated_at: string } | null;
}> {
  const entry = await getMyEntry(albumId);
  if (!entry) return { entry: null, review: null };

  const supabase = await createClient();
  // No status filter: RLS already limits this to rows the caller may read, and
  // an author keeps access to their own removed review. Filtering to `live`
  // here would make a moderated review look deleted to the person who wrote it,
  // and they would write it again.
  const { data, error } = await supabase
    .from('reviews')
    .select('id, body, status, updated_at')
    .eq('collection_entry_id', entry.id)
    .maybeSingle();

  if (error) throw error;
  return { entry, review: data ?? null };
}

/**
 * One album in a user's collection, shaped for the collection grid.
 *
 * Flattened at the service boundary rather than handed over as a nested
 * PostgREST row, so the page maps presentation concerns and nothing else.
 */
export type CollectionListItem = {
  entryId: string;
  albumId: string;
  mbid: string;
  title: string;
  credit: string;
  /** Null when the catalogue holds no release date — never invented. */
  year: number | null;
  hasArtwork: boolean;
  /** Null is unrated. `0.0` is a real score and must survive the mapping. */
  score: number | null;
  liked: boolean;
  relistens: number;
};

/**
 * A user's collection, newest addition first.
 *
 * **Ordered by `added_at` descending, deliberately — not by
 * `coalesce(listened_on, added_at)`.** The collection answers "what have I most
 * recently added", which is a fact about the account. `listened_on` is a
 * user-asserted claim about the past that may be backdated to 1997, so ordering
 * by it would let a backfill of old records displace everything someone added
 * this week, and the grid would reshuffle around a date nothing on the page
 * displays.
 *
 * Two consequences worth knowing:
 *
 *  - It is **index-backed**. `collection_entries_user_idx` is
 *    `(user_id, added_at desc)`, which is exactly this query. The coalesce
 *    ordering cannot be indexed at all — casting timestamptz to date depends on
 *    the session time zone, so the expression is not IMMUTABLE and Postgres
 *    rejects it in an index. The cheaper ordering is also the correct one here.
 *  - `listened_on` is untouched and still selected by nothing here. It remains
 *    available for explicit sorting later, which is a separate slice.
 *
 * Public by decision: everything user-generated is public, so this takes a
 * `userId` and applies no viewer filtering. The RLS policy is
 * `for select using (true)` and `anon` holds `select`, so a signed-out visitor
 * reads exactly what a signed-in one does.
 */
export async function listCollection(userId: string): Promise<CollectionListItem[]> {
  const supabase = await createClient();

  // `collection_entries.album_id` is the only relationship to `albums`, so this
  // embed needs no foreign-key disambiguation — unlike `releases`, which has
  // two paths and must name the key.
  const { data, error } = await supabase
    .from('collection_entries')
    .select(
      'id, album_id, rating, liked, relisten_count, albums(mbid, title, display_credit, artwork_status, first_release_date)',
    )
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).flatMap(toCollectionListItem);
}

/**
 * One joined row, flattened for the grid.
 *
 * Exported and pure so it can be tested directly. The integration suite proves
 * the query — ordering, isolation, what the database actually returns — but it
 * cannot call this service, because `createClient` is cookie-bound and there is
 * no request scope in a test. Without this seam the mapping itself would be the
 * one part of the read path nothing exercised, and it is where the sharp edges
 * are: a real `0.0` score, an album with no release date, artwork that is
 * `failed` rather than merely missing.
 *
 * Returns an array so callers can `flatMap`: an entry whose album did not come
 * back cannot be rendered, and dropping it keeps the return type honest instead
 * of inventing a placeholder album to stand in for it. The foreign key makes
 * that unreachable in practice.
 */
export function toCollectionListItem(row: {
  id: string;
  album_id: string;
  rating: number | null;
  liked: boolean;
  relisten_count: number;
  albums: {
    mbid: string;
    title: string;
    display_credit: string;
    artwork_status: Database['public']['Enums']['artwork_status'];
    first_release_date: string | null;
  } | null;
}): CollectionListItem[] {
  if (!row.albums) return [];

  return [
    {
      entryId: row.id,
      albumId: row.album_id,
      mbid: row.albums.mbid,
      title: row.albums.title,
      credit: row.albums.display_credit,
      // A partial date is stored as a full date with a precision marker, so the
      // leading four characters are the year under every precision.
      year: row.albums.first_release_date
        ? Number(row.albums.first_release_date.slice(0, 4))
        : null,
      // Only `found` means there is an image to fetch. `absent` and `failed`
      // are different facts — one about the artwork, one about the network —
      // and both render the placeholder, which is why they collapse here and
      // nowhere else.
      hasArtwork: row.albums.artwork_status === 'found',
      // Compared against null explicitly so a stored `0.0` survives. `rating ||
      // null` or a falsiness check would silently turn the lowest real score in
      // the product into "unrated", which is the bug this shape exists to
      // prevent and which the unit test pins.
      score: row.rating === null ? null : Number(row.rating),
      liked: row.liked,
      relistens: row.relisten_count,
    },
  ];
}

/** Explicit add. The date is optional and freely backdated. */
export async function addToCollection(albumId: string, listenedOn?: string | null) {
  return ensureEntry(albumId, listenedOn);
}

/**
 * Removes an album from the collection.
 *
 * **Locked semantics (2026-08-19).** Removal destroys the entry and everything
 * that hangs off it:
 *
 *   review          deleted, by cascade. The interface must warn first —
 *                   losing a long review to a button labelled only "Remove"
 *                   is the failure this rule exists to prevent.
 *   relisten events deleted, by cascade. They are meaningless without a parent.
 *   rating, like    columns on the row, so they go with it. The album's
 *                   average recomputes on the next read, since averages are
 *                   never stored.
 *   favourites      untouched. Independent of the collection by decision C.
 *   Want to Listen  untouched. The clearing rule is one-directional — it fires
 *                   on entry creation and never in reverse — so removal does
 *                   not infer that the user now intends to listen again.
 *
 * The service does not itself confirm. Confirmation is a UI responsibility;
 * this is the mechanism.
 */
export async function removeFromCollection(
  albumId: string,
): Promise<Result<null, 'onboarding_required'>> {
  const profileId = await requireProfileId();
  if (!profileId.ok) return profileId;

  const supabase = await createClient();
  const { error } = await supabase
    .from('collection_entries')
    .delete()
    .eq('user_id', profileId.data)
    .eq('album_id', albumId);

  if (error) throw error;
  return ok(null);
}

/** Sets or clears a rating. Implicitly adds the album. */
export async function rateAlbum(
  albumId: string,
  rating: number | null,
): Promise<Result<CollectionEntry, MutationError>> {
  if (!isValidRating(rating)) {
    return err('invalid_rating', 'Ratings run from 0.0 to 10.0, to one decimal place.');
  }
  return updateEntry(albumId, { rating });
}

/** Sets or clears the like. Implicitly adds the album. */
export async function setLiked(
  albumId: string,
  liked: boolean,
): Promise<Result<CollectionEntry, MutationError>> {
  return updateEntry(albumId, { liked });
}

/**
 * Shared tail for the implicit-add mutations.
 *
 * Ensures the entry through the single path, then writes the field. Keeping
 * this in one place is what stops the clearing rule being reimplemented per
 * action and forgotten in one of them.
 */
async function updateEntry(
  albumId: string,
  patch: Partial<Pick<CollectionEntry, 'rating' | 'liked'>>,
): Promise<Result<CollectionEntry, MutationError>> {
  const entry = await ensureEntry(albumId);
  if (!entry.ok) return entry;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('collection_entries')
    .update(patch)
    .eq('id', entry.data.id)
    .select()
    .single();

  if (error) {
    if (error.code === CHECK_VIOLATION) {
      return err('invalid_rating', 'Ratings run from 0.0 to 10.0, to one decimal place.');
    }
    throw error;
  }
  return ok(data);
}
