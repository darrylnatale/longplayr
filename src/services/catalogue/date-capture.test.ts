import { describe, expect, it } from 'vitest';

import { classifyMissingDate, isCaptureFault, payloadDateValue } from './date-capture';

/**
 * Whether a missing release date was upstream truth or our own loss
 * (`architecture.md` §17c).
 *
 * **The case worth reading first is `lost`.** A narrower check that only asked
 * "does this value parse" would report a payload holding a perfectly good date
 * as though upstream had sent nothing — concealing a loss that happened after
 * parsing rather than during it.
 */

const group = (date?: unknown) =>
  date === undefined
    ? { id: 'x', title: 'y' }
    : { id: 'x', title: 'y', 'first-release-date': date };

describe('classifyMissingDate', () => {
  it('calls it upstream truth when the key is absent', () => {
    // MusicBrainz omits the field rather than sending an empty string, so this
    // is upstream silence and not a shape we failed to read.
    expect(classifyMissingDate(group())).toBe('upstream-empty');
  });

  it('calls it upstream truth when the value is empty', () => {
    expect(classifyMissingDate(group(''))).toBe('upstream-empty');
    expect(classifyMissingDate(group(null))).toBe('upstream-empty');
  });

  it('calls it lost when the payload held a valid date the column does not', () => {
    // The case a parse-only check would hide.
    expect(classifyMissingDate(group('1971-03-12'))).toBe('lost');
    expect(classifyMissingDate(group('1971'))).toBe('lost');
    expect(classifyMissingDate(group('1971-03'))).toBe('lost');
  });

  it('calls it malformed when the payload held a value the pattern rejects', () => {
    // Silent loss at parse: a date was given and thrown away.
    expect(classifyMissingDate(group('12 March 1971'))).toBe('malformed');
    expect(classifyMissingDate(group('1971-3-2'))).toBe('malformed');
    expect(classifyMissingDate(group('197X'))).toBe('malformed');
  });

  it('concludes nothing when no payload is stored', () => {
    expect(classifyMissingDate(null)).toBe('no-payload');
    expect(classifyMissingDate(undefined)).toBe('no-payload');
  });

  it('reports an unexpected shape rather than guessing at it', () => {
    // §7a stores responses verbatim so nothing depends on their shape. A shape
    // this cannot read is its own answer, not an exception and not a silent
    // "upstream had nothing".
    expect(classifyMissingDate('a string')).toBe('unreadable');
    expect(classifyMissingDate(42)).toBe('unreadable');
    expect(classifyMissingDate(group({ nested: true }))).toBe('unreadable');
  });
});

describe('isCaptureFault', () => {
  it('counts both loss paths as ours', () => {
    expect(isCaptureFault('lost')).toBe(true);
    expect(isCaptureFault('malformed')).toBe(true);
  });

  it('counts upstream silence and unknowns as not ours', () => {
    // An unreadable payload is a reason to look, not evidence of a fault — and
    // reporting it as one would inflate the number that decides whether any
    // remediation is needed at all.
    for (const verdict of ['upstream-empty', 'no-payload', 'unreadable'] as const) {
      expect(isCaptureFault(verdict)).toBe(false);
    }
  });
});

describe('payloadDateValue', () => {
  it('surfaces the raw upstream value, so a fault is diagnosable', () => {
    expect(payloadDateValue(group('12 March 1971'))).toBe('12 March 1971');
  });

  it('is null when there was nothing to show', () => {
    expect(payloadDateValue(group())).toBeNull();
    expect(payloadDateValue(null)).toBeNull();
  });
});
