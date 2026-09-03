import { describe, expect, it } from 'vitest';

import { cursorFrom, notificationsPath } from './pagination';

/**
 * The notifications cursor validator.
 *
 * **This file exists because of a defect, and the byte-identity assertions are
 * the reason it is worth keeping.** The timestamp is interpolated into a
 * PostgREST `or()` filter, where a comma is grammar rather than data. The
 * original validator used `Date.parse`, which accepts `"2020-01-01,"`; that
 * reached the filter, produced `PGRST100`, and made `/notifications` answer 500
 * for a hand-edited URL.
 *
 * Two properties are pinned here and both matter:
 *
 * - **Nothing outside a closed alphabet reaches the query.** Grammar characters
 *   are rejected, so a cursor cannot become a filter.
 * - **An accepted timestamp is returned unchanged, to the microsecond.** Postgres
 *   carries microseconds and `Date.toISOString()` emits milliseconds, so a round
 *   trip would move the pagination boundary and silently drop rows inside the
 *   same millisecond. **Anyone reintroducing `toISOString()` fails these tests
 *   rather than quietly losing notifications.**
 */

const ID = '0b0e4f1e-1111-4000-8000-000000000001';

describe('cursorFrom — the failing case that caused this', () => {
  it('rejects a timestamp with a trailing comma', () => {
    // `Date.parse('2020-01-01,')` is a valid number. That is the whole bug.
    expect(Number.isNaN(Date.parse('2020-01-01,'))).toBe(false);
    expect(cursorFrom('2020-01-01,', ID)).toBeNull();
  });
});

describe('cursorFrom — grammar characters cannot reach the filter', () => {
  it.each([
    ['comma', '2026-09-03T08:40:31+00:00,id.gt.0'],
    ['trailing comma', '2026-09-03T08:40:31.106813+00:00,'],
    ['closing parenthesis', '2026-09-03T08:40:31+00:00)'],
    ['opening parenthesis', '(2026-09-03T08:40:31+00:00'],
    ['double quote', '2026-09-03T08:40:31+00:00"'],
    ['whitespace', '2026-09-03T08:40:31 +00:00'],
  ])('rejects %s', (_label, value) => {
    expect(cursorFrom(value, ID)).toBeNull();
  });
});

describe('cursorFrom — malformed input falls back to page one', () => {
  it.each([
    ['a bare date with no time', '2020-01-01'],
    ['no offset at all', '2026-09-03T08:40:31.106813'],
    ['seven fractional digits', '2026-09-03T08:40:31.1234567+00:00'],
    ['a function call', 'now()'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(cursorFrom(value, ID)).toBeNull();
  });

  it('rejects a calendar date that does not exist', () => {
    // A regex cannot know February has no thirtieth, and JavaScript rolls it
    // forward to 2 March rather than refusing. The round-trip check is what
    // catches it.
    expect(cursorFrom('2026-02-30T00:00:00+00:00', ID)).toBeNull();
  });

  it.each([
    ['month 13', '2026-13-01T00:00:00+00:00'],
    ['hour 25', '2026-09-03T25:00:00+00:00'],
    ['minute 61', '2026-09-03T08:61:00+00:00'],
  ])('rejects %s', (_label, value) => {
    expect(cursorFrom(value, ID)).toBeNull();
  });

  it('rejects a malformed uuid', () => {
    expect(cursorFrom('2026-09-03T08:40:31.106813+00:00', 'abc,id.gt.0')).toBeNull();
    expect(cursorFrom('2026-09-03T08:40:31.106813+00:00', 'not-a-uuid')).toBeNull();
  });

  it('requires both halves, since the keyset comparison needs the pair', () => {
    expect(cursorFrom('2026-09-03T08:40:31.106813+00:00', undefined)).toBeNull();
    expect(cursorFrom(undefined, ID)).toBeNull();
  });
});

describe('cursorFrom — every form PostgREST emits is accepted, byte for byte', () => {
  // PostgREST trims trailing zeros, so all of these are timestamps this
  // implementation can legitimately produce.
  it.each([
    ['six fractional digits', '2026-09-03T08:40:31.106813+00:00'],
    ['five, trailing zero trimmed', '2026-09-03T08:40:31.10681+00:00'],
    ['one fractional digit', '2026-09-03T08:40:31.5+00:00'],
    ['one, from .100000', '2026-09-03T08:40:31.1+00:00'],
    ['a whole second, no fraction', '2026-09-03T08:40:31+00:00'],
    ['Z instead of an offset', '2026-09-03T08:40:31Z'],
    ['a non-UTC offset', '2026-09-03T08:40:31.106813+02:00'],
  ])('accepts %s and returns it unchanged', (_label, value) => {
    const cursor = cursorFrom(value, ID);
    expect(cursor).not.toBeNull();
    // **Byte-identical.** This is the assertion that fails if anyone routes the
    // value through Date.toISOString().
    expect(cursor!.before).toBe(value);
  });

  it('preserves microseconds that toISOString would truncate', () => {
    const value = '2026-09-03T08:40:31.106813+00:00';
    const cursor = cursorFrom(value, ID);

    expect(cursor!.before).toBe(value);
    // What the rejected implementation would have produced, for contrast.
    expect(cursor!.before).not.toBe(new Date(value).toISOString());
    expect(cursor!.before.endsWith('.106813+00:00')).toBe(true);
  });

  it('returns the uuid from the validated match rather than the raw input', () => {
    const cursor = cursorFrom('2026-09-03T08:40:31.106813+00:00', ID);
    expect(cursor!.beforeId).toBe(ID);
  });

  it('takes the first value when the query string repeats a key', () => {
    const cursor = cursorFrom(['2026-09-03T08:40:31Z', 'ignored'], [ID, 'ignored']);
    expect(cursor!.before).toBe('2026-09-03T08:40:31Z');
    expect(cursor!.beforeId).toBe(ID);
  });
});

describe('notificationsPath', () => {
  it('gives the first page exactly one address', () => {
    expect(notificationsPath(null)).toBe('/notifications');
  });

  it('round-trips a generated cursor', () => {
    const before = '2026-09-03T08:40:31.106813+00:00';
    const path = notificationsPath({ before, beforeId: ID });
    const query = new URLSearchParams(path.split('?')[1]);

    // Through the URL and back out again, unchanged.
    const parsed = cursorFrom(
      query.get('before') ?? undefined,
      query.get('before_id') ?? undefined,
    );
    expect(parsed).toEqual({ before, beforeId: ID });
  });
});
