import { describe, expect, it } from 'vitest';

import { authoriseCronRequest } from './cron-auth';

const SECRET = 'a-real-secret-value';

describe('authoriseCronRequest — production', () => {
  it('rejects when no secret is configured', () => {
    // The important case. A production deployment missing CRON_SECRET must fail
    // closed, not silently expose an endpoint that spends our rate limit.
    const result = authoriseCronRequest({
      authorizationHeader: null,
      secret: undefined,
      isProduction: true,
    });

    expect(result).toEqual({ authorised: false, reason: 'CRON_SECRET is not configured' });
  });

  it('rejects an empty or whitespace secret as unconfigured', () => {
    for (const secret of ['', '   ']) {
      expect(
        authoriseCronRequest({ authorizationHeader: null, secret, isProduction: true }).authorised,
      ).toBe(false);
    }
  });

  it('accepts a matching bearer token', () => {
    expect(
      authoriseCronRequest({
        authorizationHeader: `Bearer ${SECRET}`,
        secret: SECRET,
        isProduction: true,
      }),
    ).toEqual({ authorised: true });
  });

  it('rejects a missing, wrong or malformed token', () => {
    const cases = [null, '', 'Bearer wrong', SECRET, `bearer ${SECRET}`, `Bearer ${SECRET} extra`];

    for (const authorizationHeader of cases) {
      expect(
        authoriseCronRequest({ authorizationHeader, secret: SECRET, isProduction: true })
          .authorised,
        `expected ${JSON.stringify(authorizationHeader)} to be rejected`,
      ).toBe(false);
    }
  });
});

describe('authoriseCronRequest — development', () => {
  it('allows an unauthenticated call when no secret is set', () => {
    // Convenience only, and only where a leak costs nothing.
    expect(
      authoriseCronRequest({
        authorizationHeader: null,
        secret: undefined,
        isProduction: false,
      }),
    ).toEqual({ authorised: true });
  });

  it('still enforces the token once a secret is configured', () => {
    expect(
      authoriseCronRequest({
        authorizationHeader: null,
        secret: SECRET,
        isProduction: false,
      }).authorised,
    ).toBe(false);
  });
});
