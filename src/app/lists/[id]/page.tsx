import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlbumCover } from '@/components/AlbumCover';
import { AlbumGrid } from '@/components/AlbumGrid';
import { ArtistCredit } from '@/components/ArtistCredit';
import { Container } from '@/components/Container';
import { ReportControl } from '@/components/ReportControl';
import { EditListForm } from '@/components/EditListForm';
import { getList } from '@/services/lists';
import { getMyListLikes, listLikeCount } from '@/services/social/list-likes';
import { getCurrentProfile } from '@/services/profiles';

import { removeItemAction, reorderItemAction, toggleListLikeAction } from './actions';
import { albumPath } from '@/lib/paths';

/**
 * The public list page.
 *
 * **`[id]` is the List's database UUID** (`architecture.md` §16.4). No slug, so
 * a list has exactly one address.
 *
 * **Numbered when ranked, a plain grid when not** — `product-spec.md` §List
 * page. The stored positions are identical either way; `is_ranked` decides only
 * whether the reader is shown them, which is why toggling it is lossless.
 *
 * **A removed list is filtered by RLS, not here.** It stays visible to its own
 * author and is absent for everyone else, exactly as a removed review is.
 */

export async function generateMetadata({ params }: PageProps<'/lists/[id]'>) {
  const { id } = await params;
  const list = await getList(id);
  if (!list) return { title: 'Not found · longplayr' };
  return { title: `${list.title} · longplayr` };
}

export default async function ListPage({ params }: PageProps<'/lists/[id]'>) {
  const { id } = await params;
  const list = await getList(id);

  if (!list) notFound();

  const viewer = await getCurrentProfile();
  const isOwner = viewer?.id === list.owner.id;

  // **After `getList`, because it can `notFound()` — but these two together.**
  // The page already awaited twice sequentially; adding two more round trips in
  // series would compound the pattern §46 recorded on the album page.
  const [likeCount, myLikes] = await Promise.all([
    listLikeCount(list.id),
    getMyListLikes([list.id]),
  ]);
  const likedByMe = myLikes.has(list.id);

  // **The count renders for everyone** — `product-spec.md` §6 specifies it
  // unconditionally. **The control does not**: a signed-out visitor sees no
  // control, matching the review-like convention, and the owner sees none
  // because they cannot like their own list.
  const canLike = viewer !== null && !isOwner;

  return (
    <Container variant="content">
      <header className="mt-8">
        <h1 className="text-2xl text-text">{list.title}</h1>

        <p className="mt-2 text-sm text-text-secondary">
          A list by{' '}
          <Link href={`/${list.owner.handle}`} className="transition-colors hover:text-text">
            {list.owner.displayName ?? list.owner.handle}
          </Link>
        </p>

        <div className="mt-3 flex items-center gap-3">
          <p className="text-sm text-text-secondary" data-testid="list-like-count">
            {likeCount === 1 ? '1 like' : `${likeCount} likes`}
          </p>

          {canLike && (
            <form action={toggleListLikeAction.bind(null, list.id)}>
              <input type="hidden" name="liked" value={likedByMe ? 'false' : 'true'} />
              <button
                type="submit"
                aria-pressed={likedByMe}
                className="rounded-full border border-border px-3 py-1 text-sm text-text-secondary transition-colors hover:text-text"
              >
                {likedByMe ? 'Liked' : 'Like'}
              </button>
            </form>
          )}
        </div>

        {list.description && (
          <p className="mt-4 max-w-prose whitespace-pre-line text-text-secondary">
            {list.description}
          </p>
        )}

        {list.status === 'removed' && (
          <p className="mt-4 rounded-sm border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger-text">
            This list has been removed. Only you can see it.
          </p>
        )}
      </header>

      {/* The owner edits; everybody else may report. The two are mutually
          exclusive by construction rather than by a second condition. */}
      {!isOwner && viewer && (
        <div className="mt-4">
          <ReportControl kind="list" id={list.id} label="Report this list" />
        </div>
      )}

      {isOwner && (
        <div className="mt-6">
          <EditListForm
            id={list.id}
            handle={list.owner.handle}
            title={list.title}
            description={list.description}
            isRanked={list.isRanked}
          />
        </div>
      )}

      {list.items.length === 0 ? (
        <p className="mt-8 text-sm text-text-faint">
          {isOwner ? 'Add albums from an album page.' : 'Nothing in this list yet.'}
        </p>
      ) : list.isRanked ? (
        <ol className="mt-8 flex flex-col gap-3 pb-12">
          {list.items.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-4 rounded-md border border-border bg-surface p-3"
            >
              <span className="tabular w-8 shrink-0 text-right text-sm text-text-faint">
                {index + 1}
              </span>

              <Link href={albumPath(item.album)} className="w-14 shrink-0">
                <AlbumCover
                  mbid={item.album.mbid}
                  title={item.album.title}
                  hasArtwork={item.album.artwork_status === 'found'}
                  px={56}
                  size={250}
                />
              </Link>

              <span className="min-w-0 flex-1">
                <Link
                  href={albumPath(item.album)}
                  className="block truncate text-text transition-colors hover:text-accent"
                >
                  {item.album.title}
                </Link>
                {/*
                 * **No restructuring needed here, unlike the grid.** This
                 * credit already sits outside the title's anchor, so a link
                 * nests inside nothing — the invalid-HTML problem
                 * `design-reference.md` §11.12 solves for `AlbumGrid` never
                 * existed on this surface.
                 */}
                <ArtistCredit
                  artists={item.album.artists}
                  fallback={item.album.display_credit}
                  className="block truncate text-sm text-text-secondary"
                />
              </span>

              {isOwner && (
                <span className="flex shrink-0 items-center gap-1">
                  {/* Move-to-index, so first and last are the same operation as
                      any other move. Disabled at the ends rather than hidden, so
                      the control does not jump about as items move. */}
                  <form action={reorderItemAction.bind(null, list.id, item.id, index - 1)}>
                    <button
                      type="submit"
                      disabled={index === 0}
                      aria-label={`Move ${item.album.title} up`}
                      className="rounded-sm border border-border bg-raised px-2 py-1 text-xs text-text-secondary transition-colors hover:border-border-strong disabled:opacity-40"
                    >
                      <span aria-hidden>↑</span>
                    </button>
                  </form>

                  <form action={reorderItemAction.bind(null, list.id, item.id, index + 1)}>
                    <button
                      type="submit"
                      disabled={index === list.items.length - 1}
                      aria-label={`Move ${item.album.title} down`}
                      className="rounded-sm border border-border bg-raised px-2 py-1 text-xs text-text-secondary transition-colors hover:border-border-strong disabled:opacity-40"
                    >
                      <span aria-hidden>↓</span>
                    </button>
                  </form>

                  <form action={removeItemAction.bind(null, list.id, item.album.id)}>
                    <button
                      type="submit"
                      aria-label={`Remove ${item.album.title}`}
                      className="rounded-sm border border-danger/50 bg-danger/10 px-2 py-1 text-xs text-danger-text transition-colors hover:bg-danger/20"
                    >
                      Remove
                    </button>
                  </form>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-8 pb-12">
          <AlbumGrid albums={list.items.map((item) => item.album)} />

          {isOwner && (
            <ul className="mt-6 flex flex-col gap-2">
              {list.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-text-secondary">
                    {item.album.title}
                  </span>
                  <form action={removeItemAction.bind(null, list.id, item.album.id)}>
                    <button
                      type="submit"
                      aria-label={`Remove ${item.album.title}`}
                      className="rounded-sm border border-danger/50 bg-danger/10 px-2 py-1 text-xs text-danger-text transition-colors hover:bg-danger/20"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Container>
  );
}
