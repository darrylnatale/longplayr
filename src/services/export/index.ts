import { createAdminClient } from '@/lib/supabase/admin';

import { getCurrentProfile } from '../profiles';
import { err, ok, type Result } from '../result';

/**
 * Taking your data with you.
 *
 * **The deletion enumeration, read instead of deleted** (`architecture.md`
 * §15.2). §87 had to establish every table that holds user data in order to
 * prove nothing survived a hard delete; this walks the same list and keeps it.
 * The two are the same obligation from opposite ends — `product-spec.md` §4
 * records them side by side.
 *
 * **Reads go through the service-role client**, not the caller's token. Not for
 * privilege — a user may read all of this — but because **a removed review or
 * list must appear in its author's export**, and the ordinary read paths now
 * filter those out by status (§16.9). The owner check is the `profile.id`
 * predicate on every query below, and there is no path here that takes an id
 * from a caller.
 *
 * **Generated synchronously.** At the scale this product holds, that is
 * nothing. Somewhere in the low thousands of entries it becomes a job and an
 * email; the ceiling is recorded rather than pretended away.
 */

/** Enough album identity to mean something elsewhere. Not a catalogue copy. */
type ExportedAlbum = { mbid: string; title: string; credit: string };

export type ExportedCollectionEntry = {
  album: ExportedAlbum;
  rating: number | null;
  liked: boolean;
  listenedOn: string | null;
  addedAt: string;
  relistens: string[];
  review: { body: string; status: string; createdAt: string; updatedAt: string } | null;
};

export type UserExport = {
  /** Bumped when the shape changes, so a consumer can tell which it holds. */
  formatVersion: 1;
  exportedAt: string;
  profile: {
    handle: string;
    displayName: string | null;
    bio: string | null;
    joinedAt: string;
  };
  collection: ExportedCollectionEntry[];
  favourites: { album: ExportedAlbum; position: number }[];
  wantToListen: { album: ExportedAlbum; addedAt: string }[];
  lists: {
    title: string;
    description: string | null;
    ranked: boolean;
    status: string;
    createdAt: string;
    items: { album: ExportedAlbum; position: number }[];
  }[];
  likes: {
    reviews: { album: ExportedAlbum; author: string }[];
    lists: { title: string; author: string }[];
  };
  follows: { following: string[]; followers: string[] };
  catalogueAdditions: { albumMbid: string; addedAt: string }[];
  /** Stated rather than silently omitted — see `architecture.md` §15.2. */
  notIncluded: Record<string, string>;
};

type AlbumRow = { mbid: string; title: string; display_credit: string } | null;

function toAlbum(row: AlbumRow): ExportedAlbum {
  // A null join would mean a cascade caught us mid-read. Exporting a blank is
  // wrong in the quiet direction, so it throws instead.
  if (!row) throw new Error('Export encountered a collection row with no album.');
  return { mbid: row.mbid, title: row.title, credit: row.display_credit };
}

/**
 * Everything the signed-in user owns, as one object.
 *
 * **Fails rather than returning a partial file.** An export that silently
 * omitted a table would satisfy every check a caller could reasonably make
 * while being exactly the thing this must not be.
 */
export async function buildUserExport(): Promise<Result<UserExport, 'unauthenticated'>> {
  const profile = await getCurrentProfile();
  if (!profile) return err('unauthenticated', 'You need to be signed in.');

  const admin = createAdminClient();
  const userId = profile.id;

  const [
    entries,
    favourites,
    wishes,
    lists,
    reviewLikes,
    listLikes,
    following,
    followers,
    additions,
  ] = await Promise.all([
    admin
      .from('collection_entries')
      .select(
        `rating, liked, listened_on, added_at,
           albums(mbid, title, display_credit),
           relisten_events(occurred_at),
           reviews(body, status, created_at, updated_at)`,
      )
      .eq('user_id', userId)
      .order('added_at', { ascending: true }),
    admin
      .from('favourite_albums')
      .select('position, albums(mbid, title, display_credit)')
      .eq('user_id', userId)
      .order('position', { ascending: true }),
    admin
      .from('want_to_listen')
      .select('added_at, albums(mbid, title, display_credit)')
      .eq('user_id', userId)
      .order('added_at', { ascending: true }),
    admin
      .from('lists')
      .select(
        `title, description, is_ranked, status, created_at,
           list_items(position, albums(mbid, title, display_credit))`,
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    admin
      .from('review_likes')
      .select(`reviews(collection_entries(albums(mbid, title, display_credit), profiles(handle)))`)
      .eq('user_id', userId),
    admin.from('list_likes').select('lists(title, profiles(handle))').eq('user_id', userId),
    admin
      .from('follows')
      .select('followee:profiles!follows_followee_id_fkey(handle)')
      .eq('follower_id', userId),
    admin
      .from('follows')
      .select('follower:profiles!follows_follower_id_fkey(handle)')
      .eq('followee_id', userId),
    admin
      .from('catalogue_additions')
      .select('album_mbid, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);

  for (const result of [
    entries,
    favourites,
    wishes,
    lists,
    reviewLikes,
    listLikes,
    following,
    followers,
    additions,
  ]) {
    if (result.error) throw result.error;
  }

  return ok({
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      handle: profile.handle,
      displayName: profile.display_name,
      bio: profile.bio,
      joinedAt: profile.created_at,
    },
    collection: (entries.data ?? []).map((row) => {
      const review = row.reviews as unknown as {
        body: string;
        status: string;
        created_at: string;
        updated_at: string;
      } | null;

      return {
        album: toAlbum(row.albums as unknown as AlbumRow),
        rating: row.rating === null ? null : Number(row.rating),
        liked: row.liked,
        listenedOn: row.listened_on,
        addedAt: row.added_at,
        // Discrete rows, because three relistens are three facts rather than a
        // counter (`data-model.md` §2). Sorted here: an embed promises no order.
        relistens: ((row.relisten_events ?? []) as { occurred_at: string }[])
          .map((r) => r.occurred_at)
          .sort(),
        review: review
          ? {
              body: review.body,
              // **A removed review is still exported**, and its status says so.
              // Moderation hides your writing from other people; it does not
              // stop it being yours. `architecture.md` §15.2.
              status: review.status,
              createdAt: review.created_at,
              updatedAt: review.updated_at,
            }
          : null,
      };
    }),
    favourites: (favourites.data ?? []).map((row) => ({
      album: toAlbum(row.albums as unknown as AlbumRow),
      position: row.position,
    })),
    wantToListen: (wishes.data ?? []).map((row) => ({
      album: toAlbum(row.albums as unknown as AlbumRow),
      addedAt: row.added_at,
    })),
    lists: (lists.data ?? []).map((row) => ({
      title: row.title,
      description: row.description,
      ranked: row.is_ranked,
      status: row.status,
      createdAt: row.created_at,
      items: ((row.list_items ?? []) as { position: number; albums: AlbumRow }[])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((item) => ({ album: toAlbum(item.albums), position: item.position })),
    })),
    likes: {
      reviews: (reviewLikes.data ?? []).flatMap((row) => {
        const entry = (
          row.reviews as unknown as {
            collection_entries: { albums: AlbumRow; profiles: { handle: string } | null } | null;
          } | null
        )?.collection_entries;
        if (!entry?.profiles) return [];
        return [{ album: toAlbum(entry.albums), author: entry.profiles.handle }];
      }),
      lists: (listLikes.data ?? []).flatMap((row) => {
        const list = row.lists as unknown as {
          title: string;
          profiles: { handle: string } | null;
        } | null;
        if (!list?.profiles) return [];
        return [{ title: list.title, author: list.profiles.handle }];
      }),
    },
    follows: {
      following: (following.data ?? []).flatMap((row) => {
        const person = row.followee as unknown as { handle: string } | null;
        return person ? [person.handle] : [];
      }),
      // **Both directions, deliberately.** A follower is somebody else's
      // action, but it is a fact about the exporting user — and every handle
      // here is public by `product-spec.md` §4 regardless.
      followers: (followers.data ?? []).flatMap((row) => {
        const person = row.follower as unknown as { handle: string } | null;
        return person ? [person.handle] : [];
      }),
    },
    catalogueAdditions: (additions.data ?? []).map((row) => ({
      albumMbid: row.album_mbid,
      addedAt: row.created_at,
    })),
    notIncluded: {
      activity:
        'Every feed event is derived from a collection entry, review or relisten already in this file.',
      notifications: 'Every notification is derived from a follow or a like already in this file.',
      catalogue:
        'Album and artist metadata belongs to MusicBrainz. Each album here carries its MBID so it can be looked up there.',
    },
  });
}

/** `longplayr-darryl-2026-09-23.json` */
export function exportFilename(handle: string, now: Date = new Date()): string {
  return `longplayr-${handle}-${now.toISOString().slice(0, 10)}.json`;
}
