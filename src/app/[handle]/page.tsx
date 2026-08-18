import { notFound } from 'next/navigation';

import { Avatar } from '@/components/Avatar';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getCurrentUser, getProfileByHandle } from '@/services/profiles';

export async function generateMetadata({ params }: PageProps<'/[handle]'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  if (!profile) return { title: 'Not found · longplayr' };
  return { title: `${profile.display_name ?? profile.handle} · longplayr` };
}

/**
 * Public profile.
 *
 * Everything user-generated is public by decision, so there is no viewer
 * permission filtering here and there is not meant to be
 * (docs/architecture.md §15).
 *
 * **What exists today is identity, and only identity.** Collection entries,
 * ratings, reviews, favourites, lists and follows are Phase 2 and Phase 4;
 * none of their tables exist. The page therefore shows one honest empty state
 * rather than a scaffold of zeroed counters — a stat cluster reading
 * "0 albums · 0 following · 0 followers" would imply those surfaces are live
 * and merely unused, which is a different and untrue claim
 * (docs/design-reference.md §3 describes the cluster; it arrives with the data).
 *
 * `CollectionGrid` is deliberately not used. There is no collection data for it
 * to render, and manufacturing some to make the page look populated would make
 * every later screenshot a lie.
 */

/** "August 2026" — from created_at, the one profile fact not currently shown. */
function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
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

  // The handle is the h1 when there is no display name, so repeating it
  // underneath would just print the same string twice.
  const hasDistinctName = Boolean(profile.display_name);

  return (
    <Container variant="content">
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
            </div>

            {hasDistinctName && <p className="mt-1 text-sm text-text-muted">@{profile.handle}</p>}

            <p className="mt-2 text-xs text-text-faint">Joined {joinedLabel(profile.created_at)}</p>
          </div>
        </div>

        {profile.bio && (
          <p className="mt-5 max-w-[62ch] font-serif text-base leading-[1.65] text-text-secondary">
            {profile.bio}
          </p>
        )}
      </header>

      <section className="mt-8">
        <SectionHeader>Collection</SectionHeader>

        {/*
         * The empty state is the real one, not a stand-in. It is framed as a
         * deliberate panel rather than a stray line of grey text so it reads as
         * designed — an unpopulated profile is the common case on a young
         * product and will be seen constantly (design-reference.md §6.6).
         */}
        <div className="rounded-md border border-dashed border-border px-6 py-14 text-center">
          <p className="font-serif text-lg text-text-secondary">
            {isOwnProfile ? 'Your collection is empty.' : 'No albums yet.'}
          </p>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-text-muted">
            {isOwnProfile
              ? 'Albums will appear here once you can add them to your collection.'
              : `${profile.handle} hasn’t added any albums yet.`}
          </p>
        </div>
      </section>
    </Container>
  );
}
