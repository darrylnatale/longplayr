import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Pagination } from '@/components/Pagination';
import { Container } from '@/components/Container';
import { CreateListForm } from '@/components/CreateListForm';
import { SectionHeader } from '@/components/SectionHeader';
import { LISTS_PAGE_SIZE, listUserLists } from '@/services/lists';
import { getCurrentProfile, getProfileByHandle } from '@/services/profiles';

import { pageFrom } from '../pagination';

/**
 * A profile's lists.
 *
 * **Numbered pagination, matching the collection and the two relationship
 * destinations** rather than the feed's keyset. A profile's lists are browsed
 * rather than consumed forward, and the total is wanted for the page count.
 *
 * **Public, and identical signed out** — everything user-generated is public.
 * The only viewer-dependent thing on the page is the owner's create form, and a
 * removed list is filtered by RLS rather than here.
 */

export async function generateMetadata({ params }: PageProps<'/[handle]/lists'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  if (!profile) return { title: 'Not found · longplayr' };
  return { title: `${profile.display_name ?? profile.handle}’s lists · longplayr` };
}

export default async function ProfileListsPage({
  params,
  searchParams,
}: PageProps<'/[handle]/lists'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);

  if (!profile) notFound();
  if (profile.status !== 'active') notFound();

  const query = await searchParams;
  const page = pageFrom(query.page);

  const viewer = await getCurrentProfile();
  const isOwner = viewer?.id === profile.id;

  const { items, total } = await listUserLists(profile.id, { page });

  // An empty result is one page showing the empty state, not zero pages.
  const totalPages = Math.max(1, Math.ceil(total / LISTS_PAGE_SIZE));

  // A page past the end is a 404 rather than a silent clamp, matching the
  // collection and relationship destinations.
  if (page > totalPages) notFound();

  return (
    <Container variant="content">
      <header className="mt-8">
        <p className="text-sm text-text-secondary">
          <Link href={`/${profile.handle}`} className="transition-colors hover:text-text">
            {profile.display_name ?? profile.handle}
          </Link>
        </p>
        <SectionHeader>Lists</SectionHeader>
      </header>

      {isOwner && (
        <div className="mt-6">
          <CreateListForm handle={profile.handle} />
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-text-faint">
          {isOwner ? 'You have not made a list yet.' : 'No lists yet.'}
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {items.map((list) => (
            <li key={list.id}>
              <Link
                href={`/lists/${list.id}`}
                className="block rounded-md border border-border bg-surface p-4 transition-colors hover:border-border-strong"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-base text-text">{list.title}</span>
                  {list.isRanked && (
                    <span className="text-xs uppercase tracking-wide text-text-faint">Ranked</span>
                  )}
                </span>
                {list.description && (
                  <span className="mt-1 block text-sm text-text-secondary">{list.description}</span>
                )}
                <span className="tabular mt-2 block text-xs text-text-faint">
                  {list.itemCount} {list.itemCount === 1 ? 'album' : 'albums'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/*
       * **The shared pager since 2026-10-02.** This page carried its own copy
       * of the markup, slightly divergent in type size and spacing — which is
       * the ordinary cost of duplication rather than a deliberate difference.
       * `design-reference.md` §13.
       *
       * Neutral labels: the axis is when a list was made, but the reader is
       * looking for a list rather than scrubbing a timeline, which is the same
       * reasoning `Pagination`'s docstring gives for relationship lists.
       */}
      <Pagination
        page={page}
        totalPages={totalPages}
        href={(n) => `/${profile.handle}/lists${n === 1 ? '' : `?page=${n}`}`}
        label="List pages"
      />
    </Container>
  );
}
