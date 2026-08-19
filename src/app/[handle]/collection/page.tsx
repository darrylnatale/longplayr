import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Avatar } from '@/components/Avatar';
import { CollectionGrid } from '@/components/CollectionGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { COLLECTION_PAGE_SIZE, listCollection } from '@/services/collection';
import { getProfileByHandle } from '@/services/profiles';

/**
 * The full Collection destination.
 *
 * The overview at `/<handle>` previews; this holds the whole set
 * (product-spec.md §6). They are different surfaces answering different
 * questions, which is why this one exists rather than the overview growing a
 * "show everything" toggle.
 *
 * **Paginated rather than unbounded.** A collection is designed to reach 400
 * albums, and 400 covers with 400 image requests is not a page. Sixty per page
 * divides evenly at the 3, 4, 5 and 12-column steps of the density ramp and
 * fills five exact rows at the widest.
 *
 * **Server-rendered pagination, addressable by `?page=n`.** No client state, no
 * infinite scroll: a page of a collection is a thing you can link someone to,
 * and the simplest mechanism that works is the one that survives being
 * bookmarked.
 *
 * Sorting and filtering are specified (product-spec.md §6) and not built. When
 * they arrive they join the query string beside `page`, which is part of why
 * the page number lives there rather than in a route segment.
 */

export async function generateMetadata({ params }: PageProps<'/[handle]/collection'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  if (!profile) return { title: 'Not found · longplayr' };
  return { title: `${profile.display_name ?? profile.handle}’s collection · longplayr` };
}

/**
 * `?page=` is user input and arrives as anything at all.
 *
 * Garbage, zero and negatives resolve to the first page rather than erroring —
 * a malformed page number is not worth a 404. Out-of-range pages are handled
 * separately, where the total is known.
 */
function pageFrom(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

/**
 * Who this collection belongs to, and the way back.
 *
 * Without it the page is a grid of covers that has lost its owner — fine when
 * you arrived from the profile, wrong when someone sent you the link.
 */
function IdentityStrip({
  handle,
  displayName,
  avatarUrl,
}: {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}) {
  return (
    <Link
      href={`/${handle}`}
      className="group inline-flex items-center gap-3 text-sm text-text-muted transition-colors hover:text-text"
    >
      <Avatar handle={handle} displayName={displayName} url={avatarUrl} px={32} />
      <span>
        <span className="text-text">{displayName ?? handle}</span>
        {displayName && <span className="ml-2">@{handle}</span>}
      </span>
    </Link>
  );
}

/**
 * Newer and Older rather than Previous and Next.
 *
 * The collection is ordered by when albums were added, so the axis is time and
 * the labels should say so. "Previous" is ambiguous about which direction it
 * moves through a reverse-chronological list.
 *
 * Renders nothing at all when everything fits on one page — a lone disabled
 * "Page 1 of 1" is furniture.
 */
function Pagination({
  handle,
  page,
  totalPages,
}: {
  handle: string;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const href = (n: number) =>
    n === 1 ? `/${handle}/collection` : `/${handle}/collection?page=${n}`;
  const link = 'rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text';

  return (
    <nav
      aria-label="Collection pages"
      className="mt-8 flex items-center justify-between border-t border-border pt-4"
    >
      <div className="flex-1">
        {page > 1 && (
          <Link href={href(page - 1)} rel="prev" className={link}>
            <span aria-hidden>←</span> Newer
          </Link>
        )}
      </div>

      <p className="tabular text-xs text-text-faint">
        Page {page} of {totalPages}
      </p>

      <div className="flex flex-1 justify-end">
        {page < totalPages && (
          <Link href={href(page + 1)} rel="next" className={link}>
            Older <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </nav>
  );
}

export default async function CollectionPage({
  params,
  searchParams,
}: PageProps<'/[handle]/collection'>) {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);

  if (!profile) notFound();
  if (profile.status !== 'active') notFound();

  const page = pageFrom((await searchParams).page);
  const { items, total } = await listCollection(profile.id, {
    limit: COLLECTION_PAGE_SIZE,
    offset: (page - 1) * COLLECTION_PAGE_SIZE,
  });

  // An empty collection is one page showing the empty state, not zero pages.
  const totalPages = Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE));

  // A page past the end is a 404 rather than a silent clamp: clamping would
  // render page 3 while the address still claimed page 9, and a URL that lies
  // about what it is showing is worse than one that admits it is gone.
  if (page > totalPages) notFound();

  return (
    <Container variant="wide">
      <header className="border-b border-border pb-6">
        <IdentityStrip
          handle={profile.handle}
          displayName={profile.display_name}
          avatarUrl={profile.avatar_url}
        />
        <h1 className="mt-4 text-2xl leading-tight text-text">Collection</h1>
      </header>

      <section className="mt-8">
        <SectionHeader
          trailing={
            total > 0 ? (
              <span className="tabular">
                {total} {total === 1 ? 'album' : 'albums'}
              </span>
            ) : undefined
          }
        >
          All albums
        </SectionHeader>

        {total === 0 ? (
          <div className="rounded-md border border-dashed border-border px-6 py-14 text-center">
            <p className="font-serif text-lg text-text-secondary">No albums yet.</p>
            <p className="mx-auto mt-2 max-w-[44ch] text-sm text-text-muted">
              {profile.handle} hasn’t added any albums yet.
            </p>
          </div>
        ) : (
          <>
            <CollectionGrid albums={items} />
            <Pagination handle={profile.handle} page={page} totalPages={totalPages} />
          </>
        )}
      </section>
    </Container>
  );
}
