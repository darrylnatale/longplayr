import { notFound } from 'next/navigation';

import { Avatar } from '@/components/Avatar';
import { CollectionGrid } from '@/components/CollectionGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { listCollection } from '@/services/collection';
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
 * (docs/architecture.md §15). The collection read takes a profile id and
 * applies no viewer scoping: signed out, you see exactly what a signed-in
 * visitor sees, which is what the end-to-end test asserts.
 *
 * **The collection is the only tab built.** The resolved profile structure is
 * `Collection | Want to Listen | Favourites` (product-spec.md §10.1), and the
 * other two have schema and service support but no interface. No tab bar is
 * rendered for a single tab: two inert tabs would be an interface for features
 * this slice does not build, and the decision that fixed the structure
 * explicitly did not schedule them.
 *
 * Still absent, and still deliberately so: the stat cluster. A cluster reading
 * "0 following · 0 followers" would imply those surfaces are live and merely
 * unused, which is untrue — follows are Phase 3. The album count sits on the
 * section header instead, where it is a count of something that genuinely
 * exists (docs/design-reference.md §3).
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

  const collection = await listCollection(profile.id);

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
        <SectionHeader
          trailing={
            collection.length > 0 ? (
              <span className="tabular">
                {collection.length} {collection.length === 1 ? 'album' : 'albums'}
              </span>
            ) : undefined
          }
        >
          Collection
        </SectionHeader>

        {collection.length === 0 ? (
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
          /*
           * Rendered at `DEFAULT_COLLECTION_MODE` with no density control.
           *
           * `CollectionTile` supports Detailed, and it stays in the design
           * system and in the gallery — but a user-facing switch is a product
           * control, and adding one was deliberately deferred rather than
           * slipped in alongside the read path. Compact is the locked default
           * here until that control is decided on its own terms.
           *
           * The consequence is deliberate and worth stating: score, like and
           * relisten markers live in Detailed, so they do not render on this
           * surface yet. Their correctness is covered where it currently lives
           * — the mapping in `collection-list.test.ts` and the rows themselves
           * in the integration suite — and Detailed stays inspectable in the
           * gallery at /design.
           */
          <CollectionGrid albums={collection} />
        )}
      </section>
    </Container>
  );
}
