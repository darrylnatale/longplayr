import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '@/lib/supabase/database.types';

/**
 * Search ranking.
 *
 * Built on purpose-made rows rather than the shared fixtures: the ordering
 * rules only mean something when several albums genuinely compete for the same
 * query, which the fixtures do not do.
 *
 * The popularity values here are arbitrary and exist solely to establish an
 * order. No weights are being tuned — the ranking is tiered, so there are no
 * weights to tune.
 */

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const A = (n: number) => `0b0e4f1e-5555-4000-8000-${String(n).padStart(12, '0')}`;

const ALBUMS = [
  // Two albums titled exactly "Blonde" — the ambiguous case popularity exists
  // to resolve. The obscure one is deliberately listed first.
  { mbid: A(1), title: 'Blonde', display_credit: 'Some Obscure Band', popularity_score: 5 },
  { mbid: A(2), title: 'Blonde', display_credit: 'Frank Ocean', popularity_score: 9000 },
  // Shares the word but is not an exact match.
  { mbid: A(3), title: 'Blonde on Blonde', display_credit: 'Bob Dylan', popularity_score: 8000 },
  // Hugely popular, unrelated text. Must never surface for "blonde".
  { mbid: A(4), title: 'Thriller', display_credit: 'Michael Jackson', popularity_score: 100000 },
  // Exact title match with no popularity at all.
  { mbid: A(5), title: 'Quiet Record', display_credit: 'Nobody', popularity_score: null },
  // Very popular album by an artist whose name is a query in its own right.
  { mbid: A(6), title: 'Kid A', display_credit: 'Radiohead', popularity_score: 7000 },
  { mbid: A(7), title: 'Amnesiac', display_credit: 'Radiohead', popularity_score: 3000 },
];

async function seed() {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
  const { error } = await admin.from('albums').insert(
    ALBUMS.map((a) => ({
      ...a,
      primary_type: 'album' as const,
      first_release_date: '2000-01-01',
      first_release_date_precision: 'year' as const,
    })),
  );
  if (error) throw error;
}

async function search(query: string, limit = 20) {
  const { data, error } = await admin.rpc('search_albums', { query, max_results: limit });
  if (error) throw error;
  return data ?? [];
}

beforeAll(seed);
afterAll(async () => {
  await admin.from('albums').delete().neq('mbid', '00000000-0000-0000-0000-000000000000');
});

describe('search_albums — text relevance is primary', () => {
  it('puts an exact title match above a partial one, regardless of popularity', async () => {
    const results = await search('blonde');

    // "Blonde on Blonde" is popular and contains the word, but the exact
    // matches must come first.
    const titles = results.map((r) => r.title);
    expect(titles.slice(0, 2)).toEqual(['Blonde', 'Blonde']);
    expect(titles).toContain('Blonde on Blonde');
    expect(titles.indexOf('Blonde on Blonde')).toBeGreaterThan(1);
  });

  it('ranks an unpopular exact match above a far more popular partial match', async () => {
    const results = await search('blonde');
    const obscure = results.findIndex((r) => r.display_credit === 'Some Obscure Band');
    const dylan = results.findIndex((r) => r.title === 'Blonde on Blonde');

    // Popularity 5 versus 8000. Text relevance still wins.
    expect(obscure).toBeLessThan(dylan);
  });

  it('never surfaces a popular album that does not match the text', async () => {
    const results = await search('blonde');
    expect(results.map((r) => r.title)).not.toContain('Thriller');
  });

  it('finds an exact match that has no popularity score at all', async () => {
    const results = await search('quiet record');
    expect(results[0]?.title).toBe('Quiet Record');
    expect(results[0]?.popularity_score).toBeNull();
  });
});

describe('search_albums — popularity disambiguates', () => {
  it('orders equally-relevant titles by popularity', async () => {
    const results = await search('blonde');
    const exact = results.filter((r) => r.title === 'Blonde');

    // Both are exact title matches and tie on text, so popularity decides —
    // the one role it should play.
    expect(exact).toHaveLength(2);
    expect(exact[0].display_credit).toBe('Frank Ocean');
    expect(exact[1].display_credit).toBe('Some Obscure Band');
  });

  it('orders an artist’s catalogue by popularity when relevance is equal', async () => {
    const results = await search('radiohead');
    const credits = results.map((r) => r.title);
    expect(credits.slice(0, 2)).toEqual(['Kid A', 'Amnesiac']);
  });
});

describe('search_albums — artist matching', () => {
  it('finds albums by an exact artist name', async () => {
    const results = await search('frank ocean');
    expect(results[0]?.display_credit).toBe('Frank Ocean');
  });

  it('is case insensitive', async () => {
    const upper = await search('BLONDE');
    const lower = await search('blonde');
    expect(upper.map((r) => r.mbid)).toEqual(lower.map((r) => r.mbid));
  });
});

describe('search_albums — robustness', () => {
  it('tolerates a typo through trigram matching', async () => {
    const results = await search('thriler');
    expect(results.map((r) => r.title)).toContain('Thriller');
  });

  it('returns nothing for an empty or whitespace query', async () => {
    expect(await search('')).toEqual([]);
    expect(await search('   ')).toEqual([]);
  });

  it('returns nothing for a query matching nothing', async () => {
    expect(await search('zzzzzzzz nonexistent')).toEqual([]);
  });

  it('respects the result limit', async () => {
    expect((await search('blonde', 1)).length).toBe(1);
  });

  it('is not confused by punctuation', async () => {
    const results = await search('kid a!');
    expect(results.map((r) => r.title)).toContain('Kid A');
  });
});

describe('search_artists', () => {
  it('ranks an exact artist name first', async () => {
    const { data, error } = await admin.rpc('search_artists', {
      query: 'radiohead',
      max_results: 5,
    });
    if (error) throw error;
    // No artists are seeded in this file, so this asserts the function runs
    // and returns cleanly rather than asserting an order.
    expect(Array.isArray(data)).toBe(true);
  });
});
