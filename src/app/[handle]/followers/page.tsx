import { notFound } from 'next/navigation';

import { RelationshipPage } from '@/components/RelationshipPage';
import { getProfileByHandle } from '@/services/profiles';
import { FOLLOW_PAGE_SIZE, listFollowers } from '@/services/social';

import { pageFrom, relationshipPath } from '../pagination';

/**
 * The Followers destination.
 *
 * One of two distinct relationship destinations (`product-spec.md` §6). The
 * profile's follower count is the navigation into it, which is the same "count
 * becomes the way through" pattern the collection preview uses.
 *
 * **Public, and identical signed out.** Everything user-generated is public, so
 * there is no viewer scoping here and there is not meant to be. What the list
 * does exclude is suspended and banned accounts — the service applies that, so
 * the count above it and the rows in it always agree.
 */

export async function generateMetadata({ params }: PageProps<'/[handle]/followers'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  if (!profile) return { title: 'Not found · longplayr' };
  return { title: `${profile.display_name ?? profile.handle}’s followers · longplayr` };
}

export default async function FollowersPage({
  params,
  searchParams,
}: PageProps<'/[handle]/followers'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);

  if (!profile) notFound();
  if (profile.status !== 'active') notFound();

  const query = await searchParams;
  const page = pageFrom(query.page);

  const { items, total } = await listFollowers(profile.id, {
    limit: FOLLOW_PAGE_SIZE,
    offset: (page - 1) * FOLLOW_PAGE_SIZE,
  });

  // An empty list is one page showing the empty state, not zero pages.
  const totalPages = Math.max(1, Math.ceil(total / FOLLOW_PAGE_SIZE));

  // A page past the end is a 404 rather than a silent clamp, matching the
  // collection destination: a URL that lies about what it is showing is worse
  // than one that admits it is gone.
  if (page > totalPages) notFound();

  return (
    <RelationshipPage
      handle={profile.handle}
      displayName={profile.display_name}
      avatarUrl={profile.avatar_url}
      title="Followers"
      users={items}
      total={total}
      page={page}
      totalPages={totalPages}
      emptyMessage={`${profile.display_name ?? profile.handle} has no followers yet.`}
      href={(n) => relationshipPath(profile.handle, 'followers', n)}
    />
  );
}
