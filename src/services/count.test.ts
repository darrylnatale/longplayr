import { describe, expect, it } from 'vitest';

import { countRows, COUNT_ONLY } from './count';

/**
 * The counting contract, exercised state by state.
 *
 * These are synthetic responses. The companion integration test proves that the
 * null-count-with-no-error state is one a real database and a real client
 * actually produce — without which this file would only be asserting that a
 * function does what it says.
 */

type Response = {
  count: number | null;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  status: number;
  statusText: string;
};

const respond = (response: Partial<Response>): Promise<Response> =>
  Promise.resolve({ count: null, error: null, status: 200, statusText: 'OK', ...response });

describe('COUNT_ONLY', () => {
  it('asks for an exact count without transferring rows', () => {
    expect(COUNT_ONLY).toEqual({ count: 'exact', head: true });
  });
});

describe('countRows — a successful count', () => {
  it('returns zero for a genuinely empty result', async () => {
    // The case the whole contract has to keep working. Nobody follows you is a
    // real answer, and it must survive a guard aimed at a null count.
    await expect(countRows(respond({ count: 0 }), 'test.empty')).resolves.toBe(0);
  });

  it('returns the count when there are rows', async () => {
    await expect(countRows(respond({ count: 7 }), 'test.rows')).resolves.toBe(7);
  });
});

describe('countRows — a null count with no error', () => {
  it('throws on the 204 the client rewrites a missing relation into', async () => {
    // The defect in one line: without this, `count ?? 0` reported zero here.
    await expect(
      countRows(respond({ count: null, status: 204, statusText: 'No Content' }), 'test.missing'),
    ).rejects.toThrow(/test\.missing/);
  });

  it('names the likely cause, so the failure is actionable', async () => {
    await expect(
      countRows(respond({ count: null, status: 204, statusText: 'No Content' }), 'test.missing'),
    ).rejects.toThrow(/schema cache/);
  });

  it.each([200, 206, 404, 500])(
    'throws on any status, not only 204 — status %i',
    async (status) => {
      // The invariant is semantic, not a list of blessed status codes. Keying on
      // 204 would encode today's client behaviour as a permanent assumption, and
      // this defect exists precisely because a client rewrote a status.
      await expect(countRows(respond({ count: null, status }), 'test.any_status')).rejects.toThrow(
        /no count returned and no error reported/,
      );
    },
  );
});

describe('countRows — a real error', () => {
  const postgrestError = {
    message: 'permission denied for table follows',
    code: '42501',
    details: 'some detail',
    hint: 'GRANT SELECT ON public.follows TO authenticated',
  };

  it('preserves every field, leading with the hint', async () => {
    // Postgres often puts the actionable fix in `hint` and nowhere else, so a
    // report that keeps only `message` throws the useful part away.
    const failure = await countRows(
      respond({ error: postgrestError, status: 403, statusText: 'Forbidden' }),
      'test.denied',
    ).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    const { message } = failure as Error;
    expect(message).toContain('GRANT SELECT ON public.follows TO authenticated');
    expect(message).toContain('42501');
    expect(message).toContain('some detail');
    expect(message).toContain('permission denied for table follows');
    expect(message).toContain('403 Forbidden');
    expect(message).toContain('test.denied');
  });

  it('keeps the original error as the cause', async () => {
    const failure = await countRows(
      respond({ error: postgrestError, status: 403, statusText: 'Forbidden' }),
      'test.denied',
    ).catch((error: Error) => error);

    expect((failure as Error).cause).toBe(postgrestError);
  });
});

describe('countRows — an error with no message', () => {
  it('synthesizes something usable from the status and the label', async () => {
    // A HEAD response has no body, so every non-404 HEAD failure arrives with an
    // empty message and no code, details or hint. Rethrown unchanged it is a
    // blank error nobody can act on.
    const failure = await countRows(
      respond({ error: { message: '' }, status: 400, statusText: 'Bad Request' }),
      'test.malformed',
    ).catch((error: Error) => error);

    const { message } = failure as Error;
    expect(message).toContain('test.malformed');
    expect(message).toContain('400 Bad Request');
    // No trailing separator where the empty message would have been.
    expect(message).not.toMatch(/—\s*$/);
  });

  it('omits the reason phrase when the protocol carries none', async () => {
    // HTTP/2 and HTTP/3 carry no reason phrase, so statusText is routinely
    // empty and printing it bare would leave a dangling space.
    const failure = await countRows(
      respond({ error: { message: '' }, status: 500, statusText: '' }),
      'test.no_reason_phrase',
    ).catch((error: Error) => error);

    expect((failure as Error).message).toContain('500');
    expect((failure as Error).message).not.toContain('500 ');
  });
});
