import { notFound } from 'next/navigation';

import { RelationshipPage } from '@/components/RelationshipPage';
import { getProfileByHandle } from '@/services/profiles';
import { FOLLOW_PAGE_SIZE, listFollowing } from '@/services/social';

import { pageFrom, relationshipPath } from '../pagination';

/**
 * The Following destination.
 *
 * The other half of the pair, and a **separate address rather than a tab** on
 * the followers page: the two hold different sets and each profile count links
 * to exactly one of them.
 *
 * Follows are asymmetric, so this list and the followers list are unrelated —
 * appearing in one implies nothing about the other, and neither is derived
 * from the other.
 */

export async function generateMetadata({ params }: PageProps<'/[handle]/following'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  if (!profile) return { title: 'Not found · longplayr' };
  return { title: `Who ${profile.display_name ?? profile.handle} follows · longplayr` };
}

export default async function FollowingPage({
  params,
  searchParams,
}: PageProps<'/[handle]/following'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);

  if (!profile) notFound();
  if (profile.status !== 'active') notFound();

  const query = await searchParams;
  const page = pageFrom(query.page);

  const { items, total } = await listFollowing(profile.id, {
    limit: FOLLOW_PAGE_SIZE,
    offset: (page - 1) * FOLLOW_PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / FOLLOW_PAGE_SIZE));
  if (page > totalPages) notFound();

  return (
    <RelationshipPage
      handle={profile.handle}
      displayName={profile.display_name}
      avatarUrl={profile.avatar_url}
      title="Following"
      users={items}
      total={total}
      page={page}
      totalPages={totalPages}
      emptyMessage={`${profile.display_name ?? profile.handle} isn’t following anyone yet.`}
      href={(n) => relationshipPath(profile.handle, 'following', n)}
    />
  );
}
