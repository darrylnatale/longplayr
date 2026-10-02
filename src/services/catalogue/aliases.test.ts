import { describe, expect, it } from 'vitest';

import { selectAliases } from './aliases';

/**
 * Which MusicBrainz aliases become rows - F-019, `architecture.md` 10.5.
 *
 * **The fixture is the real response**, not an invented one. These are the
 * twelve aliases `artist/164f0d73...?inc=aliases` returned on 2026-10-02 for
 * the artist MusicBrainz now calls *Ye*, which is also the data that settled
 * every decision in this module.
 */

/** The live payload, trimmed to the fields this code reads. */
const YE_ALIASES = [
  { name: 'Donda', type: null, locale: null, primary: null },
  { name: 'K. West', type: 'Search hint', locale: null, primary: null },
  { name: 'KanYeWest', type: 'Search hint', locale: null, primary: null },
  { name: 'Kanye', type: 'Artist name', locale: null, primary: null },
  { name: 'Kanye Omari West', type: 'Legal name', locale: 'en', primary: false },
  { name: 'Kanye West', type: 'Artist name', locale: 'zh', primary: true },
  { name: 'Kanye West', type: 'Artist name', locale: null, primary: null },
  { name: 'Kayne West', type: 'Search hint', locale: null, primary: null },
];

describe('selectAliases', () => {
  it('keeps the curated misspelling, which is the whole point', () => {
    // **`Kayne West` is a Search hint** - typo-tolerance somebody did by hand.
    // 111's phonetic fallback would never reach it, because `kayne` and `ye`
    // do not sound alike.
    const names = selectAliases(YE_ALIASES).map((row) => row.name);
    expect(names).toContain('Kayne West');
  });

  it('drops the legal name', () => {
    // A privacy decision rather than an oversight: an artist performing under
    // a pseudonym should not become findable by a birth name by default.
    expect(selectAliases(YE_ALIASES).map((row) => row.name)).not.toContain('Kanye Omari West');
  });

  it('drops the untyped alias, because the real one is an album title', () => {
    // `Donda` is an album, not a name for the artist. This is the case that
    // decided untyped aliases are noise.
    expect(selectAliases(YE_ALIASES).map((row) => row.name)).not.toContain('Donda');
  });

  it('deduplicates a name that appears twice under one type', () => {
    // **The case that would fail on a real artist.** `Kanye West` arrives twice
    // as `Artist name` - once with locale `zh`, once with none - and the table
    // is unique on (artist, name, kind), so without this the insert errors.
    const kanyeWest = selectAliases(YE_ALIASES).filter((row) => row.name === 'Kanye West');
    expect(kanyeWest).toHaveLength(1);
  });

  it('keeps the first occurrence, so locale and primary survive', () => {
    // Dropping the later duplicate keeps the richer row: the `zh` one carries
    // `primary: true`, which the untyped duplicate does not.
    const [kanyeWest] = selectAliases(YE_ALIASES).filter((row) => row.name === 'Kanye West');
    expect(kanyeWest.locale).toBe('zh');
    expect(kanyeWest.is_primary).toBe(true);
  });

  it('returns exactly the five usable aliases from this payload', () => {
    // 6 Artist name + 3 Search hint in the full response; this trimmed fixture
    // carries 4 of those typed as Artist name or Search hint plus one duplicate,
    // so five distinct rows is the arithmetic.
    expect(selectAliases(YE_ALIASES)).toHaveLength(5);
  });

  it('tolerates an absent, empty or blank alias list', () => {
    expect(selectAliases(undefined)).toEqual([]);
    expect(selectAliases(null)).toEqual([]);
    expect(selectAliases([])).toEqual([]);
    expect(selectAliases([{ name: '   ', type: 'Artist name' }])).toEqual([]);
  });

  it('ignores an alias type MusicBrainz might add later', () => {
    // Unknown types are dropped rather than guessed at - the allowlist is the
    // decision, so a new upstream type is a decision to make, not to infer.
    expect(selectAliases([{ name: 'Whatever', type: 'Brand new type' }])).toEqual([]);
  });
});
