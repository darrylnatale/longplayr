import { describe, expect, it } from 'vitest';

import { compactCopy, excerpt, formatRelativeTime } from './FeedItem';

/**
 * The three pure pieces of a feed item, in isolation.
 *
 * The feed is the only surface in longplayr that renders time at all
 * (`design-reference.md` §4), so this formatter has no other implementation to
 * be checked against, and the integration suite cannot reach it — it proves
 * which events come back, not how they read. The boundaries below are where a
 * relative time is wrong in a way nobody notices: the step from one unit to the
 * next, and the two ends.
 *
 * `now` is injected throughout, deliberately. A test that called the real clock
 * would be a timing-dependent assertion, which is the class of flake this
 * repository already carries three open items about.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');

/** `seconds` ago, as the ISO string the row would carry. */
function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe('formatRelativeTime', () => {
  it('reads "now" under a minute, rather than a count of zero', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('now');
    expect(formatRelativeTime(ago(1), NOW)).toBe('now');
    expect(formatRelativeTime(ago(59), NOW)).toBe('now');
  });

  it('steps to minutes at exactly one minute', () => {
    expect(formatRelativeTime(ago(60), NOW)).toBe('1m');
    expect(formatRelativeTime(ago(3599), NOW)).toBe('59m');
  });

  it('steps to hours at exactly one hour', () => {
    expect(formatRelativeTime(ago(3600), NOW)).toBe('1h');
    expect(formatRelativeTime(ago(14 * 3600), NOW)).toBe('14h');
    expect(formatRelativeTime(ago(86_399), NOW)).toBe('23h');
  });

  it('steps to days at exactly one day', () => {
    expect(formatRelativeTime(ago(86_400), NOW)).toBe('1d');
    expect(formatRelativeTime(ago(2 * 86_400), NOW)).toBe('2d');
    expect(formatRelativeTime(ago(7 * 86_400 - 1), NOW)).toBe('6d');
  });

  it('steps to weeks at exactly seven days', () => {
    expect(formatRelativeTime(ago(7 * 86_400), NOW)).toBe('1w');
    expect(formatRelativeTime(ago(364 * 86_400), NOW)).toBe('52w');
  });

  it('steps to years at exactly 365 days', () => {
    expect(formatRelativeTime(ago(365 * 86_400), NOW)).toBe('1y');
    expect(formatRelativeTime(ago(3 * 365 * 86_400), NOW)).toBe('3y');
  });

  it('reads "now" for a future timestamp rather than a negative count', () => {
    // Clock skew between the database and the renderer. "-1m" would be worse
    // than a small lie.
    expect(formatRelativeTime(ago(-30), NOW)).toBe('now');
    expect(formatRelativeTime(ago(-100_000), NOW)).toBe('now');
  });
});

describe('excerpt', () => {
  it('returns a short body whole, and unmarked', () => {
    expect(excerpt('Short and complete.')).toBe('Short and complete.');
  });

  it('cuts on a word boundary and marks the cut', () => {
    const body = `${'word '.repeat(80)}end`;
    const result = excerpt(body);

    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(241);
    // Never mid-word: everything before the ellipsis is whole words.
    expect(result.slice(0, -1).endsWith('word')).toBe(true);
  });

  it('does not mark a body that exactly fills the budget', () => {
    const body = 'a'.repeat(240);
    expect(excerpt(body)).toBe(body);
    expect(excerpt(body).endsWith('…')).toBe(false);
  });

  it('hard-cuts a single word longer than the budget rather than returning nothing', () => {
    const body = 'a'.repeat(400);
    const result = excerpt(body);

    expect(result).toBe(`${'a'.repeat(240)}…`);
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(excerpt('   spaced   ')).toBe('spaced');
  });
});

describe('compactCopy', () => {
  /**
   * **The `listened` wording is the load-bearing one.** longplayr is a
   * collection rather than a diary, and "listened to X" reads as a dated play —
   * the reading the one-entry-per-album rule exists to prevent.
   */
  it('says added, to a collection, and never "listened to"', () => {
    expect(compactCopy('listened')).toEqual({
      verb: 'added',
      trailing: 'to their collection',
    });
  });

  it('rates without trailing words, so the score ends the sentence', () => {
    expect(compactCopy('rated')).toEqual({ verb: 'rated', trailing: null });
  });

  /**
   * **A relisten carries no count.** `relisten_count` is the entry's running
   * total, not this event's ordinal, so rendering it beside one event would show
   * a current total against a historical action. The feed row is not given the
   * count at all; this pins the copy half of that.
   */
  it('relistens without any count or ordinal', () => {
    const copy = compactCopy('relistened');

    expect(copy).toEqual({ verb: 'relistened to', trailing: null });
    expect(JSON.stringify(copy)).not.toMatch(/\d/);
  });
});
