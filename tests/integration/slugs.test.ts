import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Readable URL slugs (`product-spec.md` §6).
 *
 * **Plain slugs, with a counter only where one is needed.** `kid-a` for the
 * first album of that title and `kid-a-2` for a second. This knowingly relaxes
 * §6's *deterministic rather than insertion-ordered* constraint, which the
 * maintainer relaxed on 2026-09-18: the product has no users, the catalogue is
 * test data, and re-ingesting it is acceptable.
 *
 * **The property that makes the relaxation narrow is asserted here.** A slug is
 * assigned once and then left alone, so **an album's URL never changes because
 * of another album** — nothing is promoted when a neighbour is renamed. Only a
 * full re-ingest in a different order reshuffles anything, which is the case
 * that was accepted.
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

/** A title nothing else in the suite uses, so counters are this test's own. */
const unique = (stem: string) => `${stem} ${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function addAlbum(mbid: string, title: string, slug?: string): Promise<string> {
  const { data, error } = await admin
    .from('albums')
    .insert({
      mbid,
      title,
      display_credit: 'Someone',
      primary_type: 'album',
      ...(slug === undefined ? {} : { slug }),
    })
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
  it('is just the title when the title is free', async () => {
    const title = unique('Solitary Record');
    const slug = await addAlbum('11112222-aaaa-4aaa-8aaa-000000000001', title);
    expect(slug).toBe(slugOf(title));
  });

  it('counts up for each further album of the same title', async () => {
    const title = unique('Greatest Hits');
    const base = slugOf(title);

    expect(await addAlbum('33334444-aaaa-4aaa-8aaa-000000000002', title)).toBe(base);
    expect(await addAlbum('55556666-aaaa-4aaa-8aaa-000000000003', title)).toBe(`${base}-2`);
    expect(await addAlbum('77778888-aaaa-4aaa-8aaa-000000000004', title)).toBe(`${base}-3`);
  });

  it('folds accents rather than mangling them', async () => {
    const slug = await addAlbum('99990000-aaaa-4aaa-8aaa-000000000005', 'Homogénic (Deluxe Xyzzy)');
    expect(slug).toBe('homogenic-deluxe-xyzzy');
  });

  it('falls back to a literal when a title has no ASCII to keep', async () => {
    // The real cost of counters over hashes: every non-Latin title competes for
    // the same base, so these read `album`, `album-2`, `album-3`. Recorded as
    // the behaviour rather than defended as good.
    const first = await addAlbum('aaaa0000-aaaa-4aaa-8aaa-000000000006', '東京は夜の七時');
    const second = await addAlbum('bbbb0000-aaaa-4aaa-8aaa-000000000007', '東京事変');

    expect(first.startsWith('album')).toBe(true);
    expect(second.startsWith('album')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('recomputes on a rename, and leaves every other album alone', async () => {
    // The property the whole design rests on: a freed base is not handed to
    // whoever holds the counter after it. Their URLs are already in the world.
    const title = unique('Shifting Title');
    const base = slugOf(title);

    const firstMbid = 'cccc0000-aaaa-4aaa-8aaa-000000000008';
    const secondMbid = 'dddd0000-aaaa-4aaa-8aaa-000000000009';
    expect(await addAlbum(firstMbid, title)).toBe(base);
    expect(await addAlbum(secondMbid, title)).toBe(`${base}-2`);

    const renamed = unique('Renamed Title');
    const { data, error } = await admin
      .from('albums')
      .update({ title: renamed })
      .eq('mbid', firstMbid)
      .select('slug')
      .single();
    if (error) throw error;
    expect(data.slug).toBe(slugOf(renamed));

    const { data: untouched } = await admin
      .from('albums')
      .select('slug')
      .eq('mbid', secondMbid)
      .single();
    expect(untouched!.slug).toBe(`${base}-2`);
  });

  it('discards a slug supplied at insert', async () => {
    const title = unique('Supplied Slug Record');
    const slug = await addAlbum('eeee0000-aaaa-4aaa-8aaa-000000000010', title, 'not-this-one');
    expect(slug).toBe(slugOf(title));
  });

  it('discards a slug written directly, recomputing from the title instead', async () => {
    // A generated column rejected any write outright; an ordinary column does
    // not, so a second trigger condition covers it. The guarantee is that the
    // *written value* never survives — not that the row is left untouched,
    // since a recompute legitimately reconsiders which base is free.
    const title = unique('Immutable Slug Record');
    const mbid = 'ffff0000-aaaa-4aaa-8aaa-000000000011';
    await addAlbum(mbid, title);

    const { data, error } = await admin
      .from('albums')
      .update({ slug: 'hijacked' })
      .eq('mbid', mbid)
      .select('slug')
      .single();
    if (error) throw error;

    expect(data.slug).not.toBe('hijacked');
    expect(data.slug).toBe(slugOf(title));
  });
});

describe('artist slugs', () => {
  it('is just the name, and counts up on a clash', async () => {
    const name = unique('Slugtest Artist');
    const base = slugOf(name);

    for (const [mbid, expected] of [
      ['1111aaaa-aaaa-4aaa-8aaa-000000000012', base],
      ['2222aaaa-aaaa-4aaa-8aaa-000000000013', `${base}-2`],
    ] as const) {
      const { data, error } = await admin
        .from('artists')
        .insert({ mbid, name, sort_name: name })
        .select('slug')
        .single();
      if (error) throw error;
      createdArtists.push(mbid);
      expect(data.slug).toBe(expected);
    }
  });
});

describe('search', () => {
  it('returns the slug, so a result can link without a second lookup', async () => {
    const title = unique('Slugsearch Testalbum');
    const mbid = '3333aaaa-aaaa-4aaa-8aaa-000000000014';
    const slug = await addAlbum(mbid, title);

    const { data, error } = await admin.rpc('search_albums', { query: title, max_results: 5 });
    if (error) throw error;

    expect(data!.find((row) => row.mbid === mbid)?.slug).toBe(slug);
  });

  it('returns the slug for artists too', async () => {
    const name = unique('Slugsearch Testartist');
    const mbid = '4444aaaa-aaaa-4aaa-8aaa-000000000015';
    const { data: inserted, error: insertError } = await admin
      .from('artists')
      .insert({ mbid, name, sort_name: name })
      .select('slug')
      .single();
    if (insertError) throw insertError;
    createdArtists.push(mbid);

    const { data, error } = await admin.rpc('search_artists', { query: name, max_results: 5 });
    if (error) throw error;

    expect(data!.find((row) => row.mbid === mbid)?.slug).toBe(inserted.slug);
  });
});

/**
 * The expected slug for a title, for assertions only.
 *
 * **Deliberately not a reimplementation of `slugify()`.** It handles the plain
 * ASCII titles these tests generate and nothing more; the accent and non-Latin
 * cases are asserted against literals above, so a divergence between this and
 * the database shows up as a failure rather than being papered over.
 */
function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
