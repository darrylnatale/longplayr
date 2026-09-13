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
        {/*
         * **Recently added leads. `design-reference.md` §11.11.**
         *
         * 11.5 settled that a lead is signalled by density and never by
         * decoration; which section earns it was never examined until now.
         * Browse Popular is an internal chart with an external top-up, and the
         * internal chart held **7 rows against a limit of 24** — so the lead was
         * roughly 70% ListenBrainz fill ordered by how mainstream a record is,
         * while the curated tranche sat in the quieter strip below it.
         *
         * **Recency is not a quality signal and this does not claim it is.** At
         * this catalogue size *recent* happens to be *curated*, which is why it
         * works now. It reopens when the internal chart reaches §8.3's floor of
         * 20 from real activity.
         *
         * Ungated, and that predates this change: an empty catalogue is a fact
         * worth stating once and this is the section that states it. Popular
         * hides itself instead, because "no popularity data" and "no albums" are
         * different conditions and only the second is worth a sentence. **The
         * gating stayed with the section it belonged to rather than with the
         * position.**
         */}
        <section className="mt-8">
          <SectionHeader trailing={recent.length > 0 ? `${recent.length}` : undefined}>
            Recently added
          </SectionHeader>
          <AlbumGrid albums={recent} density="relaxed" showCaptions />
        </section>

        {popular.length > 0 && (
          <section>
            <SectionHeader trailing={`${popular.length}`}>Popular</SectionHeader>
            <AlbumGrid albums={popular} />
          </section>
        )}
      </div>
    </Container>
  );
}
