import { describe, expect, it } from 'vitest';

import { handleSchema, isReservedHandle, normaliseHandle } from './handle';

function firstError(input: string): string | undefined {
  const result = handleSchema.safeParse(input);
  if (result.success) return undefined;
  // Only custom issues carry `params`; narrow before reading it.
  const issue = result.error.issues[0] as { params?: { reason?: string } } | undefined;
  return issue?.params?.reason;
}

describe('normaliseHandle', () => {
  it('lowercases and trims', () => {
    expect(normaliseHandle('  DarrylNatale  ')).toBe('darrylnatale');
  });
});

describe('handleSchema', () => {
  it('accepts a plain handle', () => {
    expect(handleSchema.parse('darryl')).toBe('darryl');
  });

  it('accepts digits and underscores after the first character', () => {
    expect(handleSchema.parse('a_1_b2')).toBe('a_1_b2');
  });

  it('normalises before validating, so mixed case is accepted and lowered', () => {
    expect(handleSchema.parse('DarrylNatale')).toBe('darrylnatale');
  });

  it('rejects handles shorter than the minimum', () => {
    expect(firstError('ab')).toBe('too_short');
  });

  it('rejects handles longer than the maximum', () => {
    expect(firstError('a'.repeat(31))).toBe('too_long');
  });

  it('accepts handles at both length boundaries', () => {
    expect(handleSchema.safeParse('abc').success).toBe(true);
    expect(handleSchema.safeParse('a'.repeat(30)).success).toBe(true);
  });

  it('rejects handles starting with a digit or underscore', () => {
    expect(firstError('1abc')).toBe('invalid_format');
    expect(firstError('_abc')).toBe('invalid_format');
  });

  it('rejects hyphens, spaces and other punctuation', () => {
    expect(firstError('darryl-natale')).toBe('invalid_format');
    expect(firstError('darryl natale')).toBe('invalid_format');
    expect(firstError('darryl.natale')).toBe('invalid_format');
    expect(firstError('darryl@home')).toBe('invalid_format');
  });

  it('rejects non-ASCII characters', () => {
    expect(firstError('björk')).toBe('invalid_format');
  });

  it('rejects reserved handles', () => {
    expect(firstError('admin')).toBe('reserved');
    expect(firstError('settings')).toBe('reserved');
    expect(firstError('longplayr')).toBe('reserved');
  });

  it('rejects reserved handles regardless of case', () => {
    expect(firstError('ADMIN')).toBe('reserved');
  });
});

describe('isReservedHandle', () => {
  it('covers top-level routes, which would otherwise shadow a profile', () => {
    // Every route we intend to add at the root must be reserved.
    for (const route of ['albums', 'artists', 'lists', 'search', 'notifications', 'settings']) {
      expect(isReservedHandle(route)).toBe(true);
    }
  });

  it('does not reserve ordinary handles', () => {
    expect(isReservedHandle('darryl')).toBe(false);
  });
});
