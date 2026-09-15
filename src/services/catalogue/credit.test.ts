import { describe, expect, it } from 'vitest';

import { creditIsSolely, toCreditedArtists, type AlbumArtistRow } from './credit';

/**
 * The credit rule, tested where it lives.
 *
 * **These assertions cannot move into a component test**, and that is a
 * standing constraint rather than a preference: no `.test.tsx` may be added
 * while the component harness fails at worker startup under Node v20. The rule
 * therefore sits in a pure module and the components stay thin enough that what
 * is left in them is markup.
 */

const VARIOUS_ARTISTS = '89ad4ac3-39f7-470e-963a-56509c546377';

function artist(name: string, mbid: string) {
  return { id: `id-${name}`, mbid, name };
}

describe('toCreditedArtists', () => {
  it('orders by credit position rather than by the order the embed returned', () => {
    // A PostgREST embed makes no ordering promise. Watch the Throne is credited
    // "Jay-Z & Kanye West", and reading it the other way round is a different
    // credit — so this arrives deliberately reversed.
    const rows: AlbumArtistRow[] = [
      { position: 1, artists: artist('Kanye West', 'mbid-kanye') },
      { position: 0, artists: artist('JAY-Z', 'mbid-jayz') },
    ];

    expect(toCreditedArtists(rows).map((credited) => credited.name)).toEqual([
      'JAY-Z',
      'Kanye West',
    ]);
  });

  it('drops a null artist row without dropping the rest of the credit', () => {
    const rows: AlbumArtistRow[] = [
      { position: 0, artists: artist('JAY-Z', 'mbid-jayz') },
      { position: 1, artists: null },
    ];

    expect(toCreditedArtists(rows)).toHaveLength(1);
  });

  it('returns nothing when there are no rows at all, so the caller can fall back', () => {
    expect(toCreditedArtists([])).toEqual([]);
    expect(toCreditedArtists(null)).toEqual([]);
  });

  it('names a pseudo-artist but does not make it linkable', () => {
    const rows: AlbumArtistRow[] = [
      { position: 0, artists: artist('Various Artists', VARIOUS_ARTISTS) },
    ];

    const [credited] = toCreditedArtists(rows);

    // Named, not dropped: a compilation credited to nobody would be worse than
    // one credited to "Various Artists" with nowhere to go.
    expect(credited.name).toBe('Various Artists');
    expect(credited.linkable).toBe(false);
  });

  it('makes an ordinary artist linkable', () => {
    const rows: AlbumArtistRow[] = [
      { position: 0, artists: artist('Radiohead', 'mbid-radiohead') },
    ];

    expect(toCreditedArtists(rows)[0].linkable).toBe(true);
  });

  it('matches the pseudo-artist identifier regardless of case', () => {
    const rows: AlbumArtistRow[] = [
      { position: 0, artists: artist('Various Artists', VARIOUS_ARTISTS.toUpperCase()) },
    ];

    expect(toCreditedArtists(rows)[0].linkable).toBe(false);
  });
});

describe('creditIsSolely', () => {
  const solo = toCreditedArtists([{ position: 0, artists: artist('Ye', 'mbid-ye') }]);
  const collaboration = toCreditedArtists([
    { position: 0, artists: artist('JAY-Z', 'mbid-jayz') },
    { position: 1, artists: artist('Kanye West', 'mbid-kanye') },
  ]);

  it('suppresses a solo credit on that artist own page', () => {
    expect(creditIsSolely(solo, 'mbid-ye')).toBe(true);
  });

  it('keeps a collaboration credit on one collaborator page', () => {
    // The case that matters most: without the credit, Watch the Throne would
    // read as a solo record on both JAY-Z's and Kanye West's pages.
    expect(creditIsSolely(collaboration, 'mbid-jayz')).toBe(false);
  });

  it('keeps a credit belonging to somebody else', () => {
    expect(creditIsSolely(solo, 'mbid-radiohead')).toBe(false);
  });

  it('compares identity rather than name, which is what the rename case turns on', () => {
    // An album released as "Kanye West" by an artist MusicBrainz now calls "Ye"
    // resolves to that same artist and is suppressed on their page. The old
    // rule compared strings, so the rename produced a credit line by accident.
    // `product-spec.md` §6 records that this loss was accepted deliberately.
    const renamed = toCreditedArtists([{ position: 0, artists: artist('Ye', 'mbid-ye') }]);

    expect(creditIsSolely(renamed, 'MBID-YE')).toBe(true);
  });
});
