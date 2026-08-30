import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Avatar } from '@/components/Avatar';
import { CollectionGrid } from '@/components/CollectionGrid';
import { Container } from '@/components/Container';
import { FavouriteRow } from '@/components/FavouriteRow';
import { FollowButton } from '@/components/FollowButton';
import { ProfileStats } from '@/components/ProfileStats';
import { SectionHeader } from '@/components/SectionHeader';
import { COLLECTION_PREVIEW_LIMIT, listCollection } from '@/services/collection';
import { listProfileFavourites } from '@/services/collection/favourites';
import { getCurrentProfile, getCurrentUser, getProfileByHandle } from '@/services/profiles';
import { getFollowCounts, getMyFollow } from '@/services/social';

import { followAction, unfollowAction } from './actions';

export async function generateMetadata({ params }: PageProps<'/[handle]'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  if (!profile) return { title: 'Not found · longplayr' };
  return { title: `${profile.display_name ?? profile.handle} · longplayr` };
}

/**
 * The profile **overview**.
 *
 * An overview, not the collection (product-spec.md §6). It summarises and links
 * onward; `/<handle>/collection` holds the whole set. The previous version
 * rendered every entry a user held, unbounded, with nowhere to link to — a
 * 400-album account would have been 400 covers on one page.
 *
 * Everything user-generated is public by decision, so there is no viewer
 * permission filtering here and there is not meant to be
 * (docs/architecture.md §15). The collection read takes a profile id and
 * applies no viewer scoping: signed out, you see exactly what a signed-in
 * visitor sees.
 *
 * **`wide`, like every other grid surface.** The overview carries a grid, and
 * grids take the wide container (design-reference.md §11.8). In `content` the
 * covers rendered at 83px — below the ~105px ceiling `standard` density
 * intends, and below the size the design system calls too small to recognise a
 * cover by. The identity block keeps its own reading measure, so widening the
 * page moves the grid and the rules, not the text.
 *
 * **The stat cluster now renders, because the condition it was waiting on has
 * been met.** This comment previously recorded that the only statistic in
 * existence was the album count, and that padding a cluster of one with "0
 * following · 0 followers" would imply surfaces that were Phase 3 — so it would
 * arrive "when it has companions". The follows slice is those companions.
 *
 * **It carries following and followers, and deliberately not the album count.**
 * The warning this comment used to make — that the album count "already appears
 * as the section header's count" and printing it twice is the failure — turned
 * out to survive the cluster's arrival. A first implementation put it in both
 * places and broke four tests on a duplicated string. The count stays in the
 * Collection header, where **the count is the navigation** (decided
 * 2026-08-19), and **"listened this year" is not added as a substitute third**:
 * `product-spec.md` §6 names it, but whether it means a calendar or a rolling
 * year, and what an entry with no `listened_on` counts as, are undecided.
 *
 * **Favourites** now render, above the collection preview, and **the section
 * disappears entirely when there are none.** No heading, no panel, no "0
 * favourites" — an empty scaffold on every profile is the same untrue claim as
 * a cluster of zeroed counters, wearing a different label. Absence is the
 * absence of anything, which is also why it reads the same to a visitor as to
 * the owner: there is nothing to prompt, because there is nowhere yet to act.
 */

/** "August 2026" — from created_at, the one profile fact not currently shown. */
function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/**
 * The collection count, and the way through to the whole collection.
 *
 * This is the borrowed "count or MORE link at the far right" pattern
 * (design-reference.md §3) doing the job it was borrowed for, rather than a
 * separate control competing with it.
 *
 * **It only becomes a link when there is more to see.** At or below the preview
 * limit the overview already shows every album the person holds, so linking on
 * would lead to a page displaying exactly the same covers — an affordance that
 * promises something and delivers nothing.
 */
function CollectionCount({ handle, total }: { handle: string; total: number }) {
  if (total === 0) return null;

  const label = `${total} ${total === 1 ? 'album' : 'albums'}`;
  if (total <= COLLECTION_PREVIEW_LIMIT) return <span className="tabular">{label}</span>;

  return (
    <Link
      href={`/${handle}/collection`}
      className="tabular text-text-muted transition-colors hover:text-text"
    >
      {label} <span aria-hidden>→</span>
    </Link>
  );
}

export default async function ProfilePage({ params }: PageProps<'/[handle]'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);

  if (!profile) notFound();

  // Suspended and banned accounts are hidden from the public. Moderation
  // tooling lands in Phase 6; the status field exists from day one so this
  // check never has to be retrofitted.
  if (profile.status !== 'active') notFound();

  const viewer = await getCurrentUser();
  const isOwnProfile = viewer?.id === profile.id;

  // Independent reads: a favourite is not a collection entry, and a follow is
  // neither, so nothing is derived from any pair.
  //
  // `getMyFollow` is only asked when there is somebody to ask about and it is
  // not the viewer themselves — the control does not render in either case, so
  // the query would be answering a question nobody put.
  const [{ items: preview, total }, favourites, counts, myFollow] = await Promise.all([
    listCollection(profile.id, { limit: COLLECTION_PREVIEW_LIMIT }),
    listProfileFavourites(profile.id),
    getFollowCounts(profile.id),
    viewer && !isOwnProfile ? getMyFollow(profile.id) : Promise.resolve(null),
  ]);

  // A signed-in visitor who has not chosen a handle has no profile row, so
  // there is nothing for a follow to be authored by. The control is withheld
  // rather than rendered into a guaranteed `onboarding_required`.
  const viewerProfile = viewer && !isOwnProfile ? await getCurrentProfile() : null;
  const canFollow = Boolean(viewerProfile);

  // The handle is the h1 when there is no display name, so repeating it
  // underneath would just print the same string twice.
  const hasDistinctName = Boolean(profile.display_name);

  return (
    <Container variant="wide">
      <header className="border-b border-border pb-8">
        <div className="flex items-start gap-5 sm:gap-6">
          <Avatar
            handle={profile.handle}
            displayName={profile.display_name}
            url={profile.avatar_url}
            px={72}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <h1 className="min-w-0 break-words font-serif text-3xl leading-[1.15] text-text sm:text-4xl">
                {profile.display_name ?? profile.handle}
              </h1>
              {isOwnProfile && (
                <span className="mt-1 shrink-0 rounded-sm border border-accent-dim px-2 py-0.5 text-xs uppercase tracking-widest text-accent">
                  You
                </span>
              )}
              {canFollow && (
                <FollowButton
                  followeeId={profile.id}
                  following={myFollow !== null}
                  followAction={followAction}
                  unfollowAction={unfollowAction}
                />
              )}
            </div>

            {hasDistinctName && <p className="mt-1 text-sm text-text-muted">@{profile.handle}</p>}

            <ProfileStats
              handle={profile.handle}
              following={counts.following}
              followers={counts.followers}
            />

            <p className="mt-2 text-xs text-text-faint">Joined {joinedLabel(profile.created_at)}</p>
          </div>
        </div>

        {profile.bio && (
          <p className="mt-5 max-w-[62ch] font-serif text-base leading-[1.65] text-text-secondary">
            {profile.bio}
          </p>
        )}
      </header>

      {favourites.length > 0 && (
        <section className="mt-8">
          <SectionHeader>Favourites</SectionHeader>
          <FavouriteRow albums={favourites} />
        </section>
      )}

      <section className="mt-8">
        <SectionHeader trailing={<CollectionCount handle={profile.handle} total={total} />}>
          Collection
        </SectionHeader>

        {total === 0 ? (
          /*
           * The empty state is the real one, not a stand-in. It is framed as a
           * deliberate panel rather than a stray line of grey text so it reads as
           * designed — an unpopulated profile is the common case on a young
           * product and will be seen constantly (design-reference.md §6.6).
           */
          <div className="rounded-md border border-dashed border-border px-6 py-14 text-center">
            <p className="font-serif text-lg text-text-secondary">
              {isOwnProfile ? 'Your collection is empty.' : 'No albums yet.'}
            </p>
            <p className="mx-auto mt-2 max-w-[44ch] text-sm text-text-muted">
              {isOwnProfile
                ? 'Add an album from its page and it will appear here.'
                : `${profile.handle} hasn’t added any albums yet.`}
            </p>
          </div>
        ) : (
          <CollectionGrid albums={preview} />
        )}
      </section>
    </Container>
  );
}
