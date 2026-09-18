import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Catalogue URLs, resolved from the identifier a fixture is defined by.
 *
 * **The specs key on MBIDs and the product now routes on slugs**
 * (`product-spec.md` §6). Rather than restating a slug in twenty files — where
 * it would silently rot the first time a fixture title changed — these look it
 * up from the same database the page reads.
 *
 * **Not hardcoded, deliberately.** A slug carries a counter when its title is
 * taken, so `in-rainbows` is only correct while nothing else in the seeded
 * catalogue is called *In Rainbows*. Asking is correct whatever the catalogue
 * holds; guessing is correct until it is not, and then fails as a 404 halfway
 * through an unrelated assertion.
 */

let client: SupabaseClient | null = null;

function admin(): SupabaseClient {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return client;
}

/** Cached per run: a fixture's slug does not change while the suite executes. */
const cache = new Map<string, string>();

async function slugFor(table: 'albums' | 'artists', mbid: string): Promise<string> {
  const key = `${table}:${mbid}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { data, error } = await admin().from(table).select('slug').eq('mbid', mbid).single();
  if (error) throw new Error(`No ${table} row for ${mbid}: ${error.message}`);

  cache.set(key, data.slug);
  return data.slug;
}

/** `/albums/<slug>` for the album with this MBID. */
export async function albumUrl(mbid: string): Promise<string> {
  return `/albums/${await slugFor('albums', mbid)}`;
}

/** `/artists/<slug>` for the artist with this MBID. */
export async function artistUrl(mbid: string): Promise<string> {
  return `/artists/${await slugFor('artists', mbid)}`;
}
