import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Avatar } from '@/components/Avatar';
import { CollectionGrid } from '@/components/CollectionGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import {
  COLLECTION_PAGE_SIZE,
  COLLECTION_SORT_OPTIONS,
  collectionPath,
  listCollection,
  parseCollectionSort,
  type CollectionSort,
} from '@/services/collection';
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
 * **Sorting joins it at `?sort=`**, on the same terms and for the same reason —
 * which is what the page number living in the query string rather than in a
 * route segment was always for. Six modes, each with one fixed direction, and
 * the default is the bare address. The modes and their orderings live in
 * `services/collection/sort.ts`; this page owns where the control sits and what
 * it looks like.
 *
 * **Filtering is still not built.** It is specified (product-spec.md §6) and
 * will land beside the sort row rather than inside it — which is the other
 * reason that row is its own element under the section header, and not six
 * links crammed into the header's single trailing slot.
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
 * The sort control: a quiet label and six fixed modes.
 *
 * **Its own row between the section header and the grid**, which is where the
 * reference puts a filter bar (design-reference.md §3, §5.6) and where the
 * filter controls will land next to it. The header's trailing slot is one
 * right-aligned affordance and already holds the album count, so six options
 * could not go there even if they fitted — and at 390px they do not.
 *
 * **Links, not a control with state**, exactly as the artist page does it. The
 * page is server-rendered and the sort lives in the URL, so each option is
 * simply the address of the collection sorted that way and the browser's back
 * button moves between them. No client component, no JavaScript required.
 *
 * The hrefs come from `collectionPath` with no page argument, which is what
 * makes "changing sort returns you to page 1" true by construction rather than
 * by a redirect: the parameter is absent, and absent already means page 1.
 *
 * **Drawn for everyone** — owner, visitor and signed-out alike (decided
 * 2026-08-21). Everything user-generated is public, sorting is a read, and a
 * viewer-conditional control would be the first anywhere in the product.
 */
function SortLinks({ handle, sort }: { handle: string; sort: CollectionSort }) {
  return (
    <nav
      aria-label="Sort collection"
      className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs"
    >
      <span className="text-text-faint">Sort</span>
      {COLLECTION_SORT_OPTIONS.map((option) =>
        option.value === sort ? (
          <span key={option.value} aria-current="true" className="text-accent">
            {option.label}
          </span>
        ) : (
          <Link
            key={option.value}
            href={collectionPath(handle, { sort: option.value })}
            className="text-text-muted underline decoration-border-strong underline-offset-4 transition-colors hover:text-text"
          >
            {option.label}
          </Link>
        ),
      )}
    </nav>
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
 *
 * **The active sort rides along.** Paging under Title must stay under Title;
 * dropping the parameter would silently return the reader to Added one page in,
 * with nothing on the page admitting it had happened.
 */
function Pagination({
  handle,
  page,
  totalPages,
  sort,
}: {
  handle: string;
  page: number;
  totalPages: number;
  sort: CollectionSort;
}) {
  if (totalPages <= 1) return null;

  const href = (n: number) => collectionPath(handle, { sort, page: n });
  const link = 'rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text';

  // Newer / Older only where the leading key is a date running newest first —
  // added, listened and release year. Under Rating, Title or Artist the axis is
  // not time and those words are simply untrue, so they give way to the neutral
  // pair rather than describing an ordering the page is no longer using.
  const chronological = sort === 'added' || sort === 'listened' || sort === 'year';
  const [backward, forward] = chronological ? ['Newer', 'Older'] : ['Previous', 'Next'];

  return (
    <nav
      aria-label="Collection pages"
      className="mt-8 flex items-center justify-between border-t border-border pt-4"
    >
      <div className="flex-1">
        {page > 1 && (
          <Link href={href(page - 1)} rel="prev" className={link}>
            <span aria-hidden>←</span> {backward}
          </Link>
        )}
      </div>

      <p className="tabular text-xs text-text-faint">
        Page {page} of {totalPages}
      </p>

      <div className="flex flex-1 justify-end">
        {page < totalPages && (
          <Link href={href(page + 1)} rel="next" className={link}>
            {forward} <span aria-hidden>→</span>
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

  const query = await searchParams;
  const page = pageFrom(query.page);
  const sort = parseCollectionSort(query.sort);

  const { items, total } = await listCollection(profile.id, {
    limit: COLLECTION_PAGE_SIZE,
    offset: (page - 1) * COLLECTION_PAGE_SIZE,
    sort,
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
            {/*
             * Withheld below two albums, on the artist page's rule that sorting
             * one thing is meaningless — withheld rather than rendered inert,
             * because an interface for a choice that does not exist is worse
             * than no interface.
             */}
            {total > 1 && <SortLinks handle={profile.handle} sort={sort} />}
            <CollectionGrid albums={items} />
            <Pagination handle={profile.handle} page={page} totalPages={totalPages} sort={sort} />
          </>
        )}
      </section>
    </Container>
  );
}
