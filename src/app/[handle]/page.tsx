import { notFound } from 'next/navigation';

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
 * Phase 0 shows identity and an empty state only. The stat cluster, favourites
 * row, collection grid and lists arrive in Phases 2 and 4 — see
 * docs/product-spec.md §6 and docs/design-reference.md §3.
 */
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

  return (
    <div>
      <header className="flex items-start justify-between gap-6 border-b border-border pb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.display_name ?? profile.handle}
          </h1>
          <p className="mt-1 text-sm text-muted">{profile.handle}</p>
          {profile.bio && <p className="mt-4 max-w-prose text-sm">{profile.bio}</p>}
        </div>

        {/* Deliberately not a stat cluster yet — there is nothing to count. */}
        {isOwnProfile && <span className="shrink-0 text-sm text-muted">This is you</span>}
      </header>

      <section className="py-16 text-center">
        <p className="text-sm text-muted">
          {isOwnProfile
            ? 'Your collection will appear here once you can add albums.'
            : `${profile.handle} hasn’t added any albums yet.`}
        </p>
      </section>
    </div>
  );
}
