import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeFailure,
  getReleaseGroup,
  isPlaceholderContact,
  isRateLimited,
  isServerBusy,
  MusicBrainzError,
  userAgent,
} from './musicbrainz';

// The real limiter paces at 0.9 req/s and the retry path sleeps 2s then 4s, so
// an unmocked three-attempt test would take six seconds to assert something
// that has nothing to do with timing. Pacing itself is covered by
// rate-limiter.test.ts against the real implementation.
vi.mock('./rate-limiter', () => ({
  RateLimiter: class {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      return task();
    }
  },
  sleep: () => Promise.resolve(),
}));

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

    // Unchanged from before the diagnostics were added. Retry policy is not
    // being tuned until the evidence is discussed — see docs/current-state.md §5.
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
