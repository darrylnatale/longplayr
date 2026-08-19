import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Avatar } from '@/components/Avatar';
import { CollectionGrid } from '@/components/CollectionGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { COLLECTION_PREVIEW_LIMIT, listCollection } from '@/services/collection';
import { getCurrentUser, getProfileByHandle } from '@/services/profiles';

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
 * **Two things are deliberately not drawn here.**
 *
 * The **stat cluster**: the only statistic that exists is the album count, and
 * it already appears as the section header's count. Printing it twice to make a
 * cluster of one, or padding it with "0 following · 0 followers", would imply
 * surfaces that are Phase 3. It arrives when it has companions.
 *
 * **Favourites**: its place in the running order is decided — above the
 * collection preview — and nothing renders for it until the feature exists. An
 * empty `FAVOURITES` heading on every profile is the same scaffold of zeroed
 * counters, wearing a different label.
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

  const { items: preview, total } = await listCollection(profile.id, {
    limit: COLLECTION_PREVIEW_LIMIT,
  });

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

      {/*
       * Favourites belongs here, above the collection preview
       * (product-spec.md §6). Reserved, not stubbed: nothing renders until the
       * feature exists.
       */}

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
