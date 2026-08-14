import { AlbumGrid } from '@/components/AlbumGrid';
import { getRecentAlbums } from '@/services/catalogue/queries';
import { getCatalogueSize, getPopularAlbums } from '@/services/discovery';

export const metadata = { title: 'Browse · longplayr' };

/**
 * Browse.
 *
 * The Phase 1 discovery surface. "Popular this week" and "highest rated this
 * week" (docs/product-spec.md §8.3) need collection and rating activity that
 * does not exist yet, so this ranks by the external popularity signal — the
 * same fallback those charts will use when internal activity is thin.
 */
export default async function BrowsePage() {
  const [popular, recent, size] = await Promise.all([
    getPopularAlbums(24),
    getRecentAlbums(24),
    getCatalogueSize(),
  ]);

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Browse</h1>
        <p className="mt-1 text-sm text-muted">
          {size.albums.toLocaleString()} {size.albums === 1 ? 'album' : 'albums'} ·{' '}
          {size.artists.toLocaleString()} {size.artists === 1 ? 'artist' : 'artists'}
        </p>
      </header>

      {popular.length > 0 && (
        <section>
          <h2 className="mb-4 border-b border-border pb-2 text-xs font-medium uppercase tracking-widest text-muted">
            Popular
          </h2>
          <AlbumGrid albums={popular} />
        </section>
      )}

      <section>
        <h2 className="mb-4 border-b border-border pb-2 text-xs font-medium uppercase tracking-widest text-muted">
          Recently added
        </h2>
        <AlbumGrid albums={recent} />
      </section>
    </div>
  );
}
