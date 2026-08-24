import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BACKGROUND_RETRY,
  browseAllReleaseGroupsByArtist,
  browseReleaseGroupsByArtist,
  DEFAULT_RETRY,
  retryDelayMs,
  describeFailure,
  getReleaseGroup,
  MAX_BROWSE_PAGES,
  isPlaceholderContact,
  MusicBrainzTransportError,
  isRateLimited,
  isServerBusy,
  MusicBrainzError,
  userAgent,
} from './musicbrainz';

// The real limiter paces at 0.9 req/s and the retry path sleeps 2s then 4s, so
// an unmocked three-attempt test would take six seconds to assert something
// that has nothing to do with timing. Pacing itself is covered by
// rate-limiter.test.ts against the real implementation.
/**
 * Records the interleaving of limiter entries and sleeps.
 *
 * The ordering is the assertion that matters: a retry must sleep *between*
 * limiter entries, never while holding one, or a backing-off request would
 * block every other caller behind it.
 */
const limiter = vi.hoisted(() => ({ schedules: 0, sleeps: [] as number[], order: [] as string[] }));

vi.mock('./rate-limiter', () => ({
  RateLimiter: class {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      limiter.schedules += 1;
      limiter.order.push('schedule');
      return task();
    }
  },
  sleep: (ms: number) => {
    limiter.sleeps.push(ms);
    limiter.order.push('sleep');
    return Promise.resolve();
  },
}));

function resetLimiter() {
  limiter.schedules = 0;
  limiter.sleeps = [];
  limiter.order = [];
}

/**
 * Response fixtures captured from the live API on 2026-08-16, verbatim.
 *
 * Both are 503. Only one is our fault, and for days we could not tell them
 * apart because the client recorded the status and discarded everything else.
 */
const BUSY_503 = {
  body: '{"error": "The MusicBrainz web server is currently busy. Please try again later."}',
  headers: {
    'x-ratelimit-zone': 'global',
    'x-ratelimit-limit': '15',
    'x-ratelimit-remaining': '12',
    'retry-after': '0',
    server: 'openresty',
  },
};

const RATE_LIMITED_503 = {
  body:
    '{"error": "Your requests are exceeding the allowable rate limit. ' +
    'Please see http://wiki.musicbrainz.org/XMLWebService for more information."}',
  headers: {
    'x-ratelimit-zone': 'ws ip=203.0.113.7',
    'x-ratelimit-limit': '22',
    'x-ratelimit-remaining': '0',
    'retry-after': '1',
    server: 'openresty',
  },
};

/**
 * A fresh Response per call, deliberately.
 *
 * A response body can be read once. Handing the same object to all three
 * attempts makes the retries look like they lost the body, which is a property
 * of the stub and not of the client.
 */
function stub503(fixture: typeof BUSY_503) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(fixture.body, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: fixture.headers,
      }),
    ),
  );
}

/**
 * The contact guard is a safety mechanism, not a nicety: an unidentifiable
 * client can get longplayr blocked at MusicBrainz for every user at once.
 * These tests make no network calls.
 */

const originalContact = process.env.MUSICBRAINZ_CONTACT;

beforeEach(() => {
  vi.restoreAllMocks();
  resetLimiter();
});

afterEach(() => {
  if (originalContact === undefined) delete process.env.MUSICBRAINZ_CONTACT;
  else process.env.MUSICBRAINZ_CONTACT = originalContact;
});

describe('isPlaceholderContact', () => {
  it('treats a missing or empty value as a placeholder', () => {
    expect(isPlaceholderContact(undefined)).toBe(true);
    expect(isPlaceholderContact('')).toBe(true);
    expect(isPlaceholderContact('   ')).toBe(true);
  });

  it('recognises common placeholder markers', () => {
    for (const value of [
      'https://placeholder.invalid',
      'dev@example.com',
      'http://localhost:3000',
      'changeme',
      'TODO',
    ]) {
      expect(isPlaceholderContact(value), `${value} should be a placeholder`).toBe(true);
    }
  });

  it('accepts a real contact URL or email', () => {
    expect(isPlaceholderContact('https://github.com/darrylnatale/longplayr')).toBe(false);
    expect(isPlaceholderContact('hello@longplayr.com')).toBe(false);
  });
});

describe('userAgent', () => {
  it('embeds the contact in the format MusicBrainz asks for', () => {
    expect(userAgent('https://github.com/darrylnatale/longplayr')).toMatch(
      /^longplayr\/\S+ \( https:\/\/github\.com\/darrylnatale\/longplayr \)$/,
    );
  });
});

describe('request guard', () => {
  it('refuses to call MusicBrainz with a placeholder contact', async () => {
    process.env.MUSICBRAINZ_CONTACT = 'https://placeholder.invalid';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getReleaseGroup('some-mbid')).rejects.toThrow(/placeholder contact/i);

    // The important assertion: nothing left the machine.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when the contact is unset entirely', async () => {
    delete process.env.MUSICBRAINZ_CONTACT;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getReleaseGroup('some-mbid')).rejects.toThrow(/MUSICBRAINZ_CONTACT/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * 503 classification.
 *
 * The seed produced 21 of these and the working assumption was rate limiting,
 * which would have meant slowing an already-conservative client down. The
 * captured bodies say otherwise, and the distinction changes the remedy.
 */
describe('503 classification', () => {
  it('recognises edge load shedding by its global zone', () => {
    expect(isServerBusy({ rateLimitZone: 'global' })).toBe(true);
  });

  it('recognises edge load shedding by its message alone', () => {
    expect(isServerBusy({ body: BUSY_503.body })).toBe(true);
  });

  it('does not mistake load shedding for rate limiting', () => {
    const diagnostics = { body: BUSY_503.body, rateLimitZone: 'global' };
    expect(isServerBusy(diagnostics)).toBe(true);
    expect(isRateLimited(diagnostics)).toBe(false);
  });

  it('recognises a genuine rate-limit response', () => {
    const diagnostics = { body: RATE_LIMITED_503.body, rateLimitZone: 'ws ip=203.0.113.7' };
    expect(isRateLimited(diagnostics)).toBe(true);
    expect(isServerBusy(diagnostics)).toBe(false);
  });

  it('classifies nothing when there are no diagnostics', () => {
    expect(isServerBusy(undefined)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
  });

  it('names the cause and the budget in the log line', () => {
    const line = describeFailure(503, '/release-group/abc', {
      body: BUSY_503.body,
      rateLimitZone: 'global',
      rateLimitLimit: '15',
      rateLimitRemaining: '12',
      retryAfter: '0',
    });

    expect(line).toContain('server busy');
    expect(line).toContain('not our rate');
    // The remaining budget is the evidence: rejected with 12 of 15 left is not
    // a client that has exhausted anything.
    expect(line).toContain('remaining=12/15');
    expect(line).toContain('currently busy');
  });
});

describe('503 diagnostics on the request path', () => {
  beforeEach(() => {
    process.env.MUSICBRAINZ_CONTACT = 'https://github.com/darrylnatale/longplayr';
  });

  it('attaches body and rate-limit headers to the thrown error', async () => {
    stub503(BUSY_503);

    const error = await getReleaseGroup('72375978-a9a1-4254-b957-85565c716b7e').catch((e) => e);

    expect(error).toBeInstanceOf(MusicBrainzError);
    expect(error.status).toBe(503);
    expect(error.diagnostics.rateLimitZone).toBe('global');
    expect(error.diagnostics.rateLimitRemaining).toBe('12');
    expect(error.diagnostics.retryAfter).toBe('0');
    expect(error.diagnostics.server).toBe('openresty');
    expect(error.diagnostics.body).toContain('currently busy');
  });

  it('says in the message that our rate was not the cause', async () => {
    stub503(BUSY_503);

    await expect(getReleaseGroup('72375978-a9a1-4254-b957-85565c716b7e')).rejects.toThrow(
      /server busy/i,
    );
  });

  it('still identifies a real rate-limit response as our fault', async () => {
    stub503(RATE_LIMITED_503);

    const error = await getReleaseGroup('72375978-a9a1-4254-b957-85565c716b7e').catch((e) => e);

    expect(isRateLimited(error.diagnostics)).toBe(true);
    expect(error.message).toContain('rate limited');
  });

  it('retries a 503 three times before giving up', async () => {
    const fetchSpy = stub503(BUSY_503);

    await expect(getReleaseGroup('72375978-a9a1-4254-b957-85565c716b7e')).rejects.toThrow();

    // `DEFAULT_RETRY` is what every interactive caller uses, and it is unchanged:
    // three attempts, as before policies existed. The longer `BACKGROUND_RETRY`
    // applies only where a caller opts into it.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('reads the body without breaking the retry loop', async () => {
    // A body can only be consumed once. Capturing diagnostics on every attempt
    // must not leave a half-read response behind.
    const fetchSpy = stub503(BUSY_503);
    const error = await getReleaseGroup('abc').catch((e) => e);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(error.diagnostics.body).toContain('currently busy');
  });
});

// ---------------------------------------------------------------------------
// Artist browse and pagination
// ---------------------------------------------------------------------------

/** Stubs fetch with a queue of JSON bodies, one per call. */
function stubPages(bodies: unknown[]) {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

const rg = (id: string) => ({ id, title: id, 'primary-type': 'Album' });
const page = (ids: string[], count?: number) => ({
  'release-groups': ids.map(rg),
  ...(count === undefined ? {} : { 'release-group-count': count }),
});

describe('browseReleaseGroupsByArtist', () => {
  beforeEach(() => {
    process.env.MUSICBRAINZ_CONTACT = 'https://github.com/darrylnatale/longplayr';
  });

  it('requests the browse endpoint with artist, limit, offset and artist-credits', async () => {
    const fetchSpy = stubPages([page([])]);

    await browseReleaseGroupsByArtist('artist-mbid', 200);

    const url = new URL((fetchSpy.mock.calls[0][0] as URL).toString());
    expect(url.pathname).toBe('/ws/2/release-group');
    expect(url.searchParams.get('artist')).toBe('artist-mbid');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('offset')).toBe('200');
    expect(url.searchParams.get('inc')).toBe('artist-credits');
    // Releases are what progressive hydration defers; asking for them here
    // would defeat the entire point.
    expect(url.searchParams.get('inc')).not.toContain('releases');
  });
});

describe('browseAllReleaseGroupsByArtist', () => {
  beforeEach(() => {
    process.env.MUSICBRAINZ_CONTACT = 'https://github.com/darrylnatale/longplayr';
  });

  it('returns a single page without asking for a second', async () => {
    const fetchSpy = stubPages([page(['a', 'b'], 2)]);

    const result = await browseAllReleaseGroupsByArtist('x');

    expect(result.groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(result.requests).toBe(1);
    expect(result.truncated).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('walks several pages and stops when the count is reached', async () => {
    const first = {
      'release-groups': Array.from({ length: 100 }, (_, i) => rg(`a${i}`)),
      'release-group-count': 150,
    };
    const second = {
      'release-groups': Array.from({ length: 50 }, (_, i) => rg(`b${i}`)),
      'release-group-count': 150,
    };
    stubPages([first, second]);

    const result = await browseAllReleaseGroupsByArtist('x');

    expect(result.groups).toHaveLength(150);
    expect(result.requests).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('treats an artist with no release groups as empty, not an error', async () => {
    // K is in the curated set and reaches this path.
    stubPages([{}]);

    const result = await browseAllReleaseGroupsByArtist('x');

    expect(result.groups).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('ends on an empty page even when the count claims more remain', async () => {
    const first = {
      'release-groups': Array.from({ length: 100 }, (_, i) => rg(`a${i}`)),
      'release-group-count': 9999,
    };
    stubPages([first, page([], 9999)]);

    const result = await browseAllReleaseGroupsByArtist('x');

    expect(result.groups).toHaveLength(100);
    expect(result.requests).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('ignores a missing count and stops when a short page arrives', async () => {
    // No count at all. A page shorter than the limit must still end the walk,
    // or a response without pagination metadata runs to the page ceiling.
    stubPages([page(['a', 'b'])]);

    const result = await browseAllReleaseGroupsByArtist('x');

    expect(result.groups).toHaveLength(2);
    expect(result.requests).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('does not double-count a release group repeated across pages', async () => {
    const first = {
      'release-groups': Array.from({ length: 100 }, (_, i) => rg(`a${i}`)),
      'release-group-count': 101,
    };
    const second = { 'release-groups': [rg('a99'), rg('b0')], 'release-group-count': 101 };
    stubPages([first, second]);

    const result = await browseAllReleaseGroupsByArtist('x');

    expect(result.groups).toHaveLength(101);
    expect(new Set(result.groups.map((g) => g.id)).size).toBe(101);
  });

  it('stops at the page ceiling and reports truncation rather than looping', async () => {
    const full = {
      'release-groups': Array.from({ length: 100 }, (_, i) => rg(`x${i}`)),
      'release-group-count': 1_000_000,
    };
    stubPages([full]);

    const result = await browseAllReleaseGroupsByArtist('x');

    expect(result.requests).toBe(MAX_BROWSE_PAGES);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

describe('retryDelayMs', () => {
  it('reproduces the previous 2s / 4s delays under the default policy', () => {
    // The behaviour every interactive caller had before policies existed.
    // Linear `2000 * attempt` and exponential `2000 * 2^(n-1)` coincide across
    // the only two delays a three-attempt policy takes.
    expect(retryDelayMs(DEFAULT_RETRY, 1)).toBe(2000);
    expect(retryDelayMs(DEFAULT_RETRY, 2)).toBe(4000);
  });

  it('grows exponentially under the background policy', () => {
    const noJitter = { ...BACKGROUND_RETRY, jitter: false };
    expect([1, 2, 3, 4].map((n) => retryDelayMs(noJitter, n))).toEqual([2000, 4000, 8000, 16000]);
  });

  it('caps any single delay at 30 seconds', () => {
    const noJitter = { ...BACKGROUND_RETRY, jitter: false };
    // Far beyond the four delays the policy actually takes: the cap is a guard
    // on future parameter changes, not a value reached today.
    expect(retryDelayMs(noJitter, 10)).toBe(30_000);
    expect(retryDelayMs(noJitter, 50)).toBe(30_000);
  });

  it('keeps jitter within [half, full] of the computed delay', () => {
    for (const n of [1, 2, 3, 4]) {
      const raw = Math.min(2000 * 2 ** (n - 1), 30_000);
      expect(retryDelayMs(BACKGROUND_RETRY, n, () => 0)).toBe(raw / 2);
      expect(retryDelayMs(BACKGROUND_RETRY, n, () => 1)).toBe(raw);
      const mid = retryDelayMs(BACKGROUND_RETRY, n, () => 0.5);
      expect(mid).toBeGreaterThanOrEqual(raw / 2);
      expect(mid).toBeLessThanOrEqual(raw);
    }
  });

  it('never returns a delay inside the one-second rate window', () => {
    // Equal jitter rather than full jitter exists for exactly this reason.
    for (const n of [1, 2, 3, 4]) {
      expect(retryDelayMs(BACKGROUND_RETRY, n, () => 0)).toBeGreaterThanOrEqual(1000);
    }
  });
});

describe('retry policy on the request path', () => {
  beforeEach(() => {
    process.env.MUSICBRAINZ_CONTACT = 'https://github.com/darrylnatale/longplayr';
  });

  it('makes three attempts by default, unchanged', async () => {
    const fetchSpy = stub503(BUSY_503);
    await getReleaseGroup('abc').catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(limiter.sleeps).toEqual([2000, 4000]);
  });

  it('makes at most five attempts under the background policy', async () => {
    const fetchSpy = stub503(BUSY_503);
    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(limiter.sleeps).toHaveLength(4);
  });

  it('sleeps between limiter entries, never while holding one', async () => {
    stub503(BUSY_503);
    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    // Five attempts, four sleeps, strictly alternating.
    expect(limiter.order).toEqual([
      'schedule',
      'sleep',
      'schedule',
      'sleep',
      'schedule',
      'sleep',
      'schedule',
      'sleep',
      'schedule',
    ]);
  });

  it('re-enters the limiter on every attempt', async () => {
    stub503(BUSY_503);
    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    expect(limiter.schedules).toBe(5);
  });

  it('keeps every background delay within the jittered bounds', async () => {
    stub503(BUSY_503);
    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    const expected = [2000, 4000, 8000, 16000];
    limiter.sleeps.forEach((ms, i) => {
      expect(ms).toBeGreaterThanOrEqual(expected[i] / 2);
      expect(ms).toBeLessThanOrEqual(expected[i]);
    });
  });

  it('stops immediately once a retry succeeds', async () => {
    let call = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      if (call < 3) {
        return Promise.resolve(
          new Response(BUSY_503.body, { status: 503, headers: BUSY_503.headers }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ 'release-groups': [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const result = await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(limiter.sleeps).toHaveLength(2);
    expect(result['release-groups']).toEqual([]);
  });

  it('preserves diagnostics when the background policy exhausts', async () => {
    stub503(BUSY_503);

    const error = await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch((e) => e);

    expect(error).toBeInstanceOf(MusicBrainzError);
    expect(error.status).toBe(503);
    expect(error.diagnostics.rateLimitZone).toBe('global');
    expect(error.diagnostics.retryAfter).toBe('0');
    expect(error.diagnostics.body).toContain('currently busy');
    expect(isServerBusy(error.diagnostics)).toBe(true);
    expect(isRateLimited(error.diagnostics)).toBe(false);
  });

  it('leaves existing callers on the default policy', async () => {
    // getReleaseGroup, getRelease and searchReleaseGroups take no policy, so
    // self-service add and the search fallback cannot inherit long waits.
    const fetchSpy = stub503(BUSY_503);
    await getReleaseGroup('abc').catch(() => undefined);
    expect(fetchSpy).toHaveBeenCalledTimes(DEFAULT_RETRY.maxAttempts);

    resetLimiter();
    fetchSpy.mockClear();
    await browseReleaseGroupsByArtist('artist').catch(() => undefined);
    expect(fetchSpy).toHaveBeenCalledTimes(DEFAULT_RETRY.maxAttempts);
  });
});

// ---------------------------------------------------------------------------
// Transport failures
// ---------------------------------------------------------------------------

/** Stubs fetch to throw, as it does on DNS, reset or socket failure. */
function stubTransportFailure(times = Number.MAX_SAFE_INTEGER) {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    call += 1;
    if (call <= times) return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(
      new Response(JSON.stringify({ 'release-groups': [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

describe('transport failures', () => {
  beforeEach(() => {
    process.env.MUSICBRAINZ_CONTACT = 'https://github.com/darrylnatale/longplayr';
  });

  it('retries a transport failure and succeeds', async () => {
    // The exact shape observed in the dry run: four artists lost to
    // `fetch failed`, each on its first and only attempt.
    const fetchSpy = stubTransportFailure(2);

    const result = await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(limiter.sleeps).toHaveLength(2);
    expect(result['release-groups']).toEqual([]);
  });

  it('exhausts the background policy after five attempts', async () => {
    const fetchSpy = stubTransportFailure();

    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(limiter.sleeps).toHaveLength(4);
  });

  it('re-enters the limiter on every transport attempt', async () => {
    stubTransportFailure();
    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    expect(limiter.schedules).toBe(5);
    expect(limiter.order).toEqual([
      'schedule',
      'sleep',
      'schedule',
      'sleep',
      'schedule',
      'sleep',
      'schedule',
      'sleep',
      'schedule',
    ]);
  });

  it('uses the same jittered delays as the HTTP path', async () => {
    stubTransportFailure();
    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    const expected = [2000, 4000, 8000, 16000];
    limiter.sleeps.forEach((ms, i) => {
      expect(ms).toBeGreaterThanOrEqual(expected[i] / 2);
      expect(ms).toBeLessThanOrEqual(expected[i]);
    });
  });

  it('keeps the default policy at three attempts and 2s / 4s', async () => {
    const fetchSpy = stubTransportFailure();

    await getReleaseGroup('abc').catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(limiter.sleeps).toEqual([2000, 4000]);
  });

  it('preserves the original transport error when exhausted', async () => {
    stubTransportFailure();

    const error = await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch((e) => e);

    expect(error).toBeInstanceOf(MusicBrainzTransportError);
    expect(error.message).toContain('failed in transport');
    expect(error.message).toContain('no HTTP response was received');
    expect(error.message).toContain('fetch failed');
    expect(error.transportCause).toBeInstanceOf(TypeError);
  });

  it('invents no HTTP status or diagnostics for a transport failure', async () => {
    stubTransportFailure();

    const error = await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch((e) => e);

    expect(error.status).toBeUndefined();
    expect(error.diagnostics).toBeUndefined();
  });

  it('never misclassifies a transport failure as busy or rate limited', async () => {
    stubTransportFailure();

    const error = await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch((e) => e);

    // A transport failure is neither. Conflating them would send the next
    // investigation looking at a rate budget that was never involved.
    expect(isServerBusy(error.diagnostics)).toBe(false);
    expect(isRateLimited(error.diagnostics)).toBe(false);
    expect(error.message).not.toContain('server busy');
    expect(error.message).not.toContain('rate limited');
    expect(error.message).not.toMatch(/\b(429|503)\b/);
  });

  it('leaves the HTTP 503 path exactly as it was', async () => {
    const fetchSpy = stub503(BUSY_503);

    const error = await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch((e) => e);

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(error).not.toBeInstanceOf(MusicBrainzTransportError);
    expect(error.status).toBe(503);
    expect(isServerBusy(error.diagnostics)).toBe(true);
  });

  it('does not retry a 404, which no amount of waiting fixes', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response('', { status: 404 })));

    await browseReleaseGroupsByArtist('artist', 0, BACKGROUND_RETRY).catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
