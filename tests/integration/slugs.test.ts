import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Readable URL slugs (`product-spec.md` §6).
 *
 * **The property worth testing is the one that made the design choice.** §6
 * requires collision resolution that is **deterministic rather than
 * insertion-ordered**, and a bare title slug cannot give that: the first of two
 * identically titled albums would take `kid-a` and the second `kid-a-2`, so the
 * same catalogue ingested in a different order would produce different URLs.
 * Appending a fixed prefix of the MBID makes every slug a pure function of its
 * own row — no collision logic, no uniqueness race, no order dependence.
 *
 * **The slug is a generated column**, so these assertions are about the
 * database rather than about any code path. That is the point: no ingest path
 * can forget to maintain it, and a rename updates it in the same statement.
 *
 * Requires the local stack: npm run db:start && npm run db:env
 */

vi.setConfig({ testTimeout: 15_000 });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin: SupabaseClient<Database> = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdAlbums: string[] = [];
const createdArtists: string[] = [];

async function addAlbum(mbid: string, title: string): Promise<string> {
  const { data, error } = await admin
    .from('albums')
    .insert({ mbid, title, display_credit: 'Someone', primary_type: 'album' })
    .select('slug')
    .single();
  if (error) throw error;
  createdAlbums.push(mbid);
  return data.slug;
}

afterAll(async () => {
  if (createdAlbums.length) await admin.from('albums').delete().in('mbid', createdAlbums);
  if (createdArtists.length) await admin.from('artists').delete().in('mbid', createdArtists);
});

describe('album slugs', () => {
  it('reads as the title, with an identity suffix', async () => {
    const slug = await addAlbum('11112222-aaaa-4aaa-8aaa-000000000001', 'Kid A');
    expect(slug).toBe('kid-a-208b8292f8');
  });

  it('gives two albums of the same title different slugs, with no collision logic', async () => {
    // The property the whole design exists for. Neither row knows about the
    // other, so ingest order cannot change either answer.
    const first = await addAlbum('33334444-aaaa-4aaa-8aaa-000000000002', 'Greatest Hits');
    const second = await addAlbum('55556666-aaaa-4aaa-8aaa-000000000003', 'Greatest Hits');

    expect(first).toBe('greatest-hits-35440cd26d');
    expect(second).toBe('greatest-hits-174761b3d8');
    expect(first).not.toBe(second);
  });

  it('separates same-titled albums whose identifiers share a prefix', async () => {
    // The case that killed the first version of this migration. It took eight
    // characters from the *front* of the MBID, which is only as well
    // distributed as the identifier is — and identifiers are often structured:
    // the search suite's fixtures all begin `0b0e4f1e-5555-4000-8000-`, so two
    // albums called Blonde collided on the first insert. Hashing the whole
    // value removes the dependence on the input happening to be random.
    const prefix = '0b0e4f1e-5555-4000-8000-';
    const first = await addAlbum(`${prefix}000000000101`, 'Shared Prefix Record');
    const second = await addAlbum(`${prefix}000000000102`, 'Shared Prefix Record');

    expect(first).not.toBe(second);
    expect(first.startsWith('shared-prefix-record-')).toBe(true);
    expect(second.startsWith('shared-prefix-record-')).toBe(true);
  });

  it('folds accents rather than mangling them', async () => {
    const slug = await addAlbum('77778888-aaaa-4aaa-8aaa-000000000004', 'Homogénic (Deluxe)');
    expect(slug).toBe('homogenic-deluxe-47a1d2b045');
  });

  it('falls back to a literal when a title has no ASCII to keep', async () => {
    // A Japanese title slugifies to nothing. The suffix carries the URL alone,
    // which is deliberate: transliteration needs a per-script table this
    // project has no reason to own.
    const slug = await addAlbum('99990000-aaaa-4aaa-8aaa-000000000005', '東京は夜の七時');
    expect(slug).toBe('album-21927e92f9');
  });

  it('follows an upstream rename, because the column is generated', async () => {
    const mbid = 'aaaabbbb-aaaa-4aaa-8aaa-000000000006';
    expect(await addAlbum(mbid, 'Kid A')).toBe('kid-a-db974d4046');

    const { data, error } = await admin
      .from('albums')
      .update({ title: 'Kid A Mnesia' })
      .eq('mbid', mbid)
      .select('slug')
      .single();
    if (error) throw error;

    expect(data.slug).toBe('kid-a-mnesia-db974d4046');
  });

  it('cannot be written directly', async () => {
    // A generated column rejects an explicit value. This is what stops any
    // future code path from setting a slug that disagrees with its title.
    const { error } = await admin
      .from('albums')
      .update({ slug: 'something-else' } as never)
      .eq('mbid', '11112222-aaaa-4aaa-8aaa-000000000001');

    expect(error).not.toBeNull();
  });
});

describe('artist slugs', () => {
  it('reads as the name, with an identity suffix', async () => {
    const mbid = 'ccccdddd-aaaa-4aaa-8aaa-000000000007';
    const { data, error } = await admin
      .from('artists')
      .insert({ mbid, name: 'Björk', sort_name: 'Björk' })
      .select('slug')
      .single();
    if (error) throw error;
    createdArtists.push(mbid);

    expect(data.slug).toBe('bjork-0e3ae5bc86');
  });
});

describe('search', () => {
  it('returns the slug, so a result can link without a second lookup', async () => {
    await addAlbum('eeeeffff-aaaa-4aaa-8aaa-000000000008', 'Slugsearch Testalbum');

    const { data, error } = await admin.rpc('search_albums', {
      query: 'Slugsearch Testalbum',
      max_results: 5,
    });
    if (error) throw error;

    const found = data!.find((row) => row.mbid === 'eeeeffff-aaaa-4aaa-8aaa-000000000008');
    expect(found?.slug).toBe('slugsearch-testalbum-13bd3962f1');
  });

  it('returns the slug for artists too', async () => {
    const mbid = '00001111-aaaa-4aaa-8aaa-000000000009';
    const { error: insertError } = await admin
      .from('artists')
      .insert({ mbid, name: 'Slugsearch Testartist', sort_name: 'Slugsearch Testartist' });
    if (insertError) throw insertError;
    createdArtists.push(mbid);

    const { data, error } = await admin.rpc('search_artists', {
      query: 'Slugsearch Testartist',
      max_results: 5,
    });
    if (error) throw error;

    const found = data!.find((row) => row.mbid === mbid);
    expect(found?.slug).toBe('slugsearch-testartist-616fae2dcc');
  });
});
