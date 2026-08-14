import { describe, expect, it } from 'vitest';

import { classify, formatPartialDate, parsePartialDate } from './scope';

/**
 * "Singles are never ingested" is a non-negotiable rule, and this is the only
 * place it is enforced. Everything downstream assumes it holds.
 */
describe('classify — in scope', () => {
  it('accepts a plain album', () => {
    expect(classify({ 'primary-type': 'Album' })).toEqual({
      inScope: true,
      primaryType: 'album',
      secondaryTypes: [],
    });
  });

  it('accepts an EP', () => {
    const result = classify({ 'primary-type': 'EP' });
    expect(result).toMatchObject({ inScope: true, primaryType: 'ep' });
  });

  it('accepts live albums, compilations and soundtracks', () => {
    for (const secondary of ['Live', 'Compilation', 'Soundtrack']) {
      const result = classify({ 'primary-type': 'Album', 'secondary-types': [secondary] });
      expect(result.inScope, `${secondary} should be in scope`).toBe(true);
    }
  });

  it('accepts a mixtape even when it has no primary type', () => {
    // MusicBrainz models "Mixtape/Street" as a secondary type, so some
    // mixtapes arrive with no primary type at all.
    const result = classify({ 'secondary-types': ['Mixtape/Street'] });
    expect(result).toEqual({ inScope: true, primaryType: 'album', secondaryTypes: ['mixtape'] });
  });

  it('maps multiple secondary types and removes duplicates', () => {
    const result = classify({
      'primary-type': 'Album',
      'secondary-types': ['Live', 'Compilation', 'Live'],
    });
    expect(result).toMatchObject({ inScope: true });
    if (result.inScope) {
      expect([...result.secondaryTypes].sort()).toEqual(['compilation', 'live']);
    }
  });

  it('ignores secondary types it does not recognise rather than failing', () => {
    const result = classify({ 'primary-type': 'Album', 'secondary-types': ['Field Recording'] });
    expect(result).toEqual({ inScope: true, primaryType: 'album', secondaryTypes: [] });
  });
});

describe('classify — out of scope', () => {
  it('rejects singles', () => {
    expect(classify({ 'primary-type': 'Single' }).inScope).toBe(false);
  });

  it('rejects a single even when it carries an accepted secondary type', () => {
    // The important case: a "Live" single must not sneak in via its secondary
    // type.
    expect(classify({ 'primary-type': 'Single', 'secondary-types': ['Live'] }).inScope).toBe(false);
  });

  it('rejects broadcasts', () => {
    expect(classify({ 'primary-type': 'Broadcast' }).inScope).toBe(false);
  });

  it('rejects audiobooks, spokenword and interviews whatever the primary type', () => {
    for (const secondary of ['Audiobook', 'Spokenword', 'Interview', 'Audio drama']) {
      const result = classify({ 'primary-type': 'Album', 'secondary-types': [secondary] });
      expect(result.inScope, `${secondary} should be out of scope`).toBe(false);
    }
  });

  it('rejects a release group with no type information', () => {
    expect(classify({}).inScope).toBe(false);
  });

  it('is case insensitive', () => {
    expect(classify({ 'primary-type': 'SINGLE' }).inScope).toBe(false);
    expect(classify({ 'primary-type': 'album' }).inScope).toBe(true);
  });
});

describe('parsePartialDate', () => {
  it('parses a full date', () => {
    expect(parsePartialDate('2004-03-12')).toEqual({ date: '2004-03-12', precision: 'day' });
  });

  it('defaults a missing day to the first of the month', () => {
    expect(parsePartialDate('2004-03')).toEqual({ date: '2004-03-01', precision: 'month' });
  });

  it('defaults a year-only date to 1 January', () => {
    expect(parsePartialDate('2004')).toEqual({ date: '2004-01-01', precision: 'year' });
  });

  it('returns null for empty or malformed input', () => {
    expect(parsePartialDate(undefined)).toBeNull();
    expect(parsePartialDate('')).toBeNull();
    expect(parsePartialDate('not a date')).toBeNull();
    expect(parsePartialDate('04-03-2004')).toBeNull();
  });
});

describe('formatPartialDate', () => {
  it('shows only the year when only the year was known', () => {
    // The whole point of the precision column: never claim a day we invented.
    expect(formatPartialDate('2004-01-01', 'year')).toBe('2004');
  });

  it('shows month and year for month precision', () => {
    expect(formatPartialDate('2004-03-01', 'month')).toBe('March 2004');
  });

  it('shows the full date for day precision', () => {
    expect(formatPartialDate('2004-03-12', 'day')).toBe('12 March 2004');
  });

  it('returns null when there is no date', () => {
    expect(formatPartialDate(null, 'day')).toBeNull();
  });
});
