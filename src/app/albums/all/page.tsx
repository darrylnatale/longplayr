import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AlbumGrid } from '@/components/AlbumGrid';
import { Container } from '@/components/Container';
import { Pagination } from '@/components/Pagination';
import { getCurrentUser } from '@/services/profiles';
import { catalogueReversedFrom, catalogueSortFrom } from '@/services/catalogue/catalogue-sort';
import { CATALOGUE_PAGE_SIZE, getCatalogueAlbums } from '@/services/catalogue/queries';

import { cataloguePath, hideHeldFrom, pageFrom, sortLinks } from './pagination';

export const metadata = { title: 'All albums · longplayr' };

/**
 * Every album in the catalogue.
 *
 * **The surface that shows what the others select away.** Browse leads with
 * Recently added, which by decision carries one album per artist and only
 * covered ones, and its Popular section excludes every album without an
 * external popularity score — which is every self-service addition. So until
 * now an album could be held by the catalogue and reachable from **no browsing
 * surface at all**, findable only by someone who already knew to search for it.
 * `product-spec.md` §6.
 *
 * **It applies no filter of any kind, and that is the point.** §8.9 holds that
 * absence of an external signal must never gate discovery; this is where that
 * stops being a principle and becomes a `where` clause deliberately not
 * written.
 *
 * **No popularity sort either** (§8.3): an external score completes a chart and
 * never orders a surface. Offering it here would reintroduce through the back
 * door what that decision removed from the front.
 */
export default async function AllAlbumsPage({ searchParams }: PageProps<'/albums/all'>) {
  const query = await searchParams;
  const sort = catalogueSortFrom(query.sort);
  const reversed = catalogueReversedFrom(query.dir);
  const page = pageFrom(query.page);
  const hideHeld = hideHeldFrom(query.mine);

  /*
   * **The viewer is resolved here, not in the service.** `getCatalogueAlbums`
   * takes a user id rather than a boolean, so a signed-out visitor cannot
   * accidentally receive a personal filter — the parameter simply has nothing
   * to carry. `architecture.md` §16.13, F-042.
   */
  const viewer = await getCurrentUser();
  const excludeHeldBy = hideHeld && viewer ? viewer.id : undefined;

  const { albums, total } = await getCatalogueAlbums({
    sort,
    reversed,
    limit: CATALOGUE_PAGE_SIZE,
    offset: (page - 1) * CATALOGUE_PAGE_SIZE,
    excludeHeldBy,
  });

  const totalPages = Math.max(1, Math.ceil(total / CATALOGUE_PAGE_SIZE));

  // Out of range is a 404, matching the relationship destinations. An empty
  // grid at page 40 of 16 would render as though the catalogue ended there.
  if (page > totalPages) notFound();

  return (
    <Container variant="wide">
      <header className="border-b border-border pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">All albums</h1>
        <p className="mt-2 text-sm text-text-muted">
          <span className="tabular">{total.toLocaleString()}</span>{' '}
          {total === 1 ? 'album' : 'albums'}{' '}
          {excludeHeldBy ? 'you have not added' : 'in the catalogue'}
        </p>

        {/*
         * **Only for a signed-in reader, and that is the decision rather than a
         * detail.** This is the first control on a catalogue surface that
         * depends on who is reading, and Browse is otherwise public and
         * identical for everyone — so for a signed-out visitor it is not
         * rendered at all rather than rendered disabled. §16.13.
         *
         * A link, not a form: every state stays addressable and the page needs
         * no client JavaScript, matching the sort control beside it.
         */}
        {viewer && (
          <p className="mt-3 text-sm">
            <Link
              href={cataloguePath(sort, 1, reversed, !hideHeld)}
              className="text-accent hover:underline"
            >
              {hideHeld ? 'Show everything' : 'Hide albums I already have'}
            </Link>
          </p>
        )}

        {/*
         * Links rather than a form, so every ordering is addressable and the
         * page needs no client JavaScript. Changing the sort returns to page
         * one: page 7 of one ordering has no counterpart in another.
         */}
        {/*
         * **Pressing the active sort reverses it**, which is what keeps this a
         * row of four rather than eight (`product-spec.md` §6). The arrow shows
         * only on the active sort, because only there does a direction mean
         * anything — and it is the affordance telling a reader the second press
         * does something.
         */}
        <nav aria-label="Sort albums" className="mt-4 flex flex-wrap gap-1">
          {sortLinks(sort, reversed, hideHeld).map((option) => (
            <Link
              key={option.value}
              href={option.href}
              aria-current={option.current ? 'true' : undefined}
              className={
                option.current
                  ? 'rounded-sm bg-raised px-3 py-1.5 text-xs text-text'
                  : 'rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text'
              }
            >
              {option.label}
              {option.current && (
                <>
                  {' '}
                  <span aria-hidden>{option.reversed ? '↑' : '↓'}</span>
                  <span className="sr-only">
                    {option.reversed ? ', reversed. Press to restore' : '. Press to reverse'}
                  </span>
                </>
              )}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mt-8 pb-12">
        {/*
         * **`relaxed` with captions, because the sort control demands it.**
         * Three of the four sorts — artist, title, year — order the grid by
         * data a caption-free wall does not show, so the page would reorder
         * itself for reasons the reader could not see. `design-reference.md`
         * §11.5 ties captions to `relaxed` and forbids them on `standard`,
         * where a cell tops out near 105px and a credit is unreadable — so
         * there is no middle option, and legibility wins over density here.
         */}
        <AlbumGrid
          albums={albums}
          density="relaxed"
          showCaptions
          emptyMessage="The catalogue is empty."
        />

        <Pagination
          page={page}
          totalPages={totalPages}
          href={(to) => cataloguePath(sort, to, reversed, hideHeld)}
          label="Catalogue pages"
        />
      </div>
    </Container>
  );
}
