import { describe, expect, it } from 'vitest';

import { authoriseQueueView } from './queue-view-auth';

/**
 * The one property worth being sure of is that it fails closed in production.
 * A deployment that forgot `QUEUE_VIEW_SECRET` must not publish its ingestion
 * internals to anyone who guesses the path — `architecture.md` §17a.
 */
describe('authoriseQueueView', () => {
  const secret = 'a-real-secret';

  it('authorises a matching key', () => {
    expect(authoriseQueueView({ key: secret, secret, isProduction: true })).toEqual({
      authorised: true,
    });
  });

  it('refuses a wrong key', () => {
    expect(authoriseQueueView({ key: 'wrong', secret, isProduction: true }).authorised).toBe(false);
  });

  it('refuses a missing key', () => {
    expect(authoriseQueueView({ key: null, secret, isProduction: true }).authorised).toBe(false);
  });

  it('refuses an empty key, rather than treating it as absent-and-allowed', () => {
    expect(authoriseQueueView({ key: '   ', secret, isProduction: true }).authorised).toBe(false);
  });

  it('FAILS CLOSED in production when no secret is configured', () => {
    // The case this file exists for.
    expect(authoriseQueueView({ key: 'anything', secret: undefined, isProduction: true })).toEqual({
      authorised: false,
      reason: 'QUEUE_VIEW_SECRET is not configured',
    });
    expect(authoriseQueueView({ key: null, secret: '', isProduction: true }).authorised).toBe(
      false,
    );
    expect(authoriseQueueView({ key: null, secret: '  ', isProduction: true }).authorised).toBe(
      false,
    );
  });

  it('opens in development when no secret is configured', () => {
    expect(authoriseQueueView({ key: null, secret: undefined, isProduction: false })).toEqual({
      authorised: true,
    });
  });

  it('still enforces a configured secret in development', () => {
    // Configuring one and then ignoring it locally would make the local page a
    // different thing from the deployed one.
    expect(authoriseQueueView({ key: 'wrong', secret, isProduction: false }).authorised).toBe(
      false,
    );
  });
});
