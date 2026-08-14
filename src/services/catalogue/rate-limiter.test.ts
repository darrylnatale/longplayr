import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimiter } from './rate-limiter';

/**
 * The rate limiter is the one piece of Phase 1 whose failure mode is a total
 * catalogue outage rather than a slow ingest, so it is tested against a fake
 * clock rather than by hoping.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets queued microtasks and any elapsed timers settle. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('RateLimiter', () => {
  it('runs the first task immediately', async () => {
    const limiter = new RateLimiter(1);
    const task = vi.fn().mockResolvedValue('a');

    const promise = limiter.schedule(task);
    await advance(0);

    expect(task).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBe('a');
  });

  it('spaces subsequent tasks by the minimum interval', async () => {
    const limiter = new RateLimiter(1);
    const order: number[] = [];

    void limiter.schedule(async () => void order.push(1));
    void limiter.schedule(async () => void order.push(2));
    void limiter.schedule(async () => void order.push(3));

    await advance(0);
    expect(order).toEqual([1]);

    // Just short of the interval: still only the first has run.
    await advance(999);
    expect(order).toEqual([1]);

    await advance(1);
    expect(order).toEqual([1, 2]);

    await advance(1000);
    expect(order).toEqual([1, 2, 3]);
  });

  it('preserves scheduling order', async () => {
    const limiter = new RateLimiter(10);
    const order: string[] = [];

    for (const name of ['a', 'b', 'c', 'd']) {
      void limiter.schedule(async () => void order.push(name));
    }

    await advance(1000);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps running later tasks after one rejects', async () => {
    const limiter = new RateLimiter(10);
    const order: string[] = [];

    const failing = limiter.schedule(async () => {
      order.push('failed');
      throw new Error('upstream exploded');
    });
    // Attach a handler immediately so this never surfaces as an unhandled
    // rejection while the fake clock advances.
    const failure = failing.catch((error: Error) => error.message);

    const following = limiter.schedule(async () => {
      order.push('after');
      return 'ok';
    });

    await advance(1000);

    // The caller still sees the rejection...
    await expect(failure).resolves.toBe('upstream exploded');
    // ...and the queue behind it is unaffected.
    await expect(following).resolves.toBe('ok');
    expect(order).toEqual(['failed', 'after']);
  });

  it('does not delay a task scheduled long after the previous one', async () => {
    const limiter = new RateLimiter(1);

    void limiter.schedule(async () => 'first');
    await advance(5000);

    const second = vi.fn().mockResolvedValue('second');
    void limiter.schedule(second);
    await advance(0);

    // The interval has long since elapsed, so no artificial wait applies.
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-positive rate', () => {
    expect(() => new RateLimiter(0)).toThrow();
    expect(() => new RateLimiter(-1)).toThrow();
  });
});
