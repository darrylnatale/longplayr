import { AlbumGrid } from '@/components/AlbumGrid';
import { Container } from '@/components/Container';
import { SectionHeader } from '@/components/SectionHeader';
import { getRecentAlbums } from '@/services/catalogue/queries';
import { getCatalogueSize, getPopularAlbums } from '@/services/discovery';

export const metadata = { title: 'Browse · longplayr' };

/**
 * Browse — the discovery surface.
 *
 * "Popular this week" and "highest rated this week" (docs/product-spec.md §8.3)
 * need collection and rating activity that does not exist yet, so this ranks by
 * the external popularity signal — the same fallback those charts will use when
 * internal activity is thin. **Ranking is not a presentation concern**: the
 * order arrives from `getPopularAlbums`, which reads `popularity_score`, and is
 * deliberately not re-sorted here.
 *
 * The two sections are ranked against each other by **size alone**, which is
 * how the structural reference signals importance on its own browse page — no
 * badges, no ribbons (docs/design-reference.md §3). Before migration both grids
 * ran at the same density, so the page stated no preference between a curated
 * chart and a raw recency list.
 *
 *   Popular          relaxed, captioned. The lead. Large enough to carry a
 *                    title and credit, which is the whole reason `relaxed`
 *                    exists — metadata buys the room it needs.
 *   Recently added   standard, caption-free. The secondary strip, and the
 *                    record-shelf wall the visual identity is built on
 *                    (docs/design-reference.md §8).
 *
 * Captions are on for the lead because the catalogue is unfamiliar and holds no
 * ratings, reviews or personal state yet — recognition alone has nothing to
 * work with, and it fails hardest on exactly the albums whose artwork is a
 * placeholder (docs/design-reference.md §6.6). They stay subordinate: artwork
 * first, then title, then credit and year quieter still.
 */
export default async function BrowsePage() {
  const [popular, recent, size] = await Promise.all([
    getPopularAlbums(24),
    getRecentAlbums(24),
    getCatalogueSize(),
  ]);

  return (
    <Container variant="wide">
      {/*
       * "Browse" is a label, not the name of a work. Newsreader is reserved for
       * things the catalogue holds — album titles, artist and member names — so
       * a serif page title here would say this word is content when the content
       * is the wall beneath it (docs/design-reference.md §4).
       */}
      <header className="border-b border-border pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">Browse</h1>
        <p className="mt-2 text-sm text-text-muted">
          <span className="tabular">{size.albums.toLocaleString()}</span>{' '}
          {size.albums === 1 ? 'album' : 'albums'} ·{' '}
          <span className="tabular">{size.artists.toLocaleString()}</span>{' '}
          {size.artists === 1 ? 'artist' : 'artists'}
        </p>
      </header>

      <div className="flex flex-col gap-12">
        {popular.length > 0 && (
          <section className="mt-8">
            <SectionHeader trailing={`${popular.length}`}>Popular</SectionHeader>
            <AlbumGrid albums={popular} density="relaxed" showCaptions />
          </section>
        )}

        {/*
         * Ungated, unlike Popular: an empty catalogue is a fact worth stating
         * once, and this is the section that states it. Popular hides itself
         * instead, because "no popularity data" and "no albums" are different
         * conditions and only the second is worth a sentence.
         */}
        <section className={popular.length > 0 ? undefined : 'mt-8'}>
          <SectionHeader trailing={recent.length > 0 ? `${recent.length}` : undefined}>
            Recently added
          </SectionHeader>
          <AlbumGrid albums={recent} />
        </section>
      </div>
    </Container>
  );
}
