import { describe, expect, it } from 'vitest';

import { initials } from './AlbumCover';

/**
 * The artwork placeholder's initials, in isolation.
 *
 * Worth testing directly because the placeholder is not an edge case — Cover
 * Art Archive has real gaps, so this is one of the most-viewed components in
 * the product's early life (`design-reference.md` §6.6) — and because the bug
 * it replaces was invisible to every existing test: an all-ASCII fixture
 * catalogue cannot reveal a function that silently drops every other script.
 *
 * The property that matters most is the last block: **no non-empty title ever
 * produces an empty placeholder.**
 */

describe('Latin titles', () => {
  it('takes one initial per word, up to three', () => {
    expect(initials('In Rainbows')).toBe('IR');
    expect(initials('Now That’s What I Call Music! 100')).toBe('NTW');
  });

  it('uppercases', () => {
    expect(initials('acid rap')).toBe('AR');
  });

  it('ignores words carrying no letter or number', () => {
    expect(initials('Sandinista! — Deluxe')).toBe('SD');
  });

  it('collapses arbitrary whitespace', () => {
    expect(initials('  Unknown   Pleasures  ')).toBe('UP');
  });
});

describe('scripts the old filter silently discarded', () => {
  // The regression this file exists for. `/[a-z0-9]/i` matched none of these,
  // so every one of them rendered a tinted square with nothing on it.
  it('renders Japanese', () => {
    expect(initials('ゆらゆら帝国')).toBe('ゆ');
  });

  it('renders Chinese', () => {
    expect(initials('華麗的冒險')).toBe('華');
  });

  it('renders Korean', () => {
    expect(initials('오아시스')).toBe('오');
  });

  it('renders Cyrillic, uppercased', () => {
    expect(initials('Гражданская оборона')).toBe('ГО');
  });

  it('renders Greek, uppercased', () => {
    expect(initials('Ρεμπέτικα')).toBe('Ρ');
  });

  it('renders Arabic', () => {
    expect(initials('أم كلثوم')).toBe('أك');
  });

  it('gives a space-free script one character rather than three', () => {
    // There is only ever one "word" to take an initial from, and the first
    // character identifies the record — the first three do not identify it
    // better, they just crowd the cell.
    expect(initials('帝国')).toHaveLength(1);
  });
});

describe('mixed and awkward titles', () => {
  it('handles a Latin and non-Latin mix', () => {
    expect(initials('Ryuichi Sakamoto 音楽図鑑')).toBe('RS音');
  });

  it('keeps digits as initials', () => {
    expect(initials('1999 Deluxe')).toBe('1D');
  });

  it('does not split a surrogate pair', () => {
    // `word[0]` would return half a pair and render a broken glyph.
    expect(initials('𝕬lbum')).toBe('𝕬');
    expect([...initials('𝕬lbum')]).toHaveLength(1);
  });
});

describe('no non-empty title is ever blank', () => {
  it('falls back to the first character when nothing is a letter or number', () => {
    // `!!!` is a real band, and an empty placeholder is worse than a literal
    // one.
    expect(initials('!!!')).toBe('!');
    expect(initials('///')).toBe('/');
  });

  it('returns something for every title the catalogue could hold', () => {
    const titles = ['In Rainbows', 'ゆらゆら帝国', '!!!', '1999', 'Ρεμπέτικα', '—', 'a', '𝕬'];

    for (const title of titles) {
      expect(initials(title), title).not.toBe('');
    }
  });

  it('returns empty only for an empty or whitespace-only title', () => {
    // Not reachable through the catalogue — `albums.title` is `not null` and
    // MusicBrainz will not hand us a blank — but the function should not throw
    // if it ever happens.
    expect(initials('')).toBe('');
    expect(initials('   ')).toBe('');
  });
});
