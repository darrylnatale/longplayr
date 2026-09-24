import { describe, expect, it } from 'vitest';

import { isRateLimited } from './rate-limit';

/**
 * Telling a ceiling apart from a fault.
 *
 * **Both arrive as a failed insert**, so the whole value of this is that a rate
 * limit becomes an outcome the UI renders while anything else stays an
 * exception. Getting it wrong in either direction is bad: a missed match turns
 * a normal limit into a crash, and an over-eager one swallows a real database
 * error as "try again later".
 */

const limited = {
  code: 'P0001',
  message: 'longplayr_rate_limited: 60 per hour on follows',
};

describe('isRateLimited', () => {
  it('recognises the trigger’s refusal', () => {
    expect(isRateLimited(limited)).toBe(true);
  });

  it('recognises it whatever the table or number', () => {
    expect(
      isRateLimited({
        code: 'P0001',
        message: 'longplayr_rate_limited: 600 per day on list_likes',
      }),
    ).toBe(true);
  });

  it('ignores a unique violation', () => {
    // Already liked. A different outcome with a different meaning.
    expect(isRateLimited({ code: '23505', message: 'duplicate key value' })).toBe(false);
  });

  it('ignores a permission error', () => {
    // §14.1's territory. Must stay an exception rather than becoming advice.
    expect(isRateLimited({ code: '42501', message: 'permission denied' })).toBe(false);
  });

  it('ignores another P0001 that is not ours', () => {
    // The marker is what distinguishes them, not the SQLSTATE — a bare `raise`
    // anywhere in the schema produces P0001 too.
    expect(isRateLimited({ code: 'P0001', message: 'handle is not available' })).toBe(false);
  });

  it('ignores the marker under the wrong code', () => {
    // Defends against a message that merely mentions it.
    expect(isRateLimited({ code: '23505', message: 'longplayr_rate_limited' })).toBe(false);
  });

  it('handles no error at all', () => {
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited({})).toBe(false);
  });
});
