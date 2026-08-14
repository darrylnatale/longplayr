/**
 * Serialising rate limiter.
 *
 * MusicBrainz allows one request per second **per IP**, averaged, and returns
 * 503 for *every* request from that address once exceeded — not just the excess
 * (docs/architecture.md §7). So the cost of getting this wrong is not a slow
 * ingest, it is a total outage of the catalogue.
 *
 * Requests are queued and released one at a time with a minimum gap between
 * them. Serialising rather than allowing bursts is deliberate: a token bucket
 * would permit a burst that trips the limit even while averaging correctly.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastStartedAt = 0;

  constructor(requestsPerSecond: number) {
    if (requestsPerSecond <= 0) {
      throw new Error('requestsPerSecond must be greater than zero');
    }
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  /**
   * Runs `task` once the limiter allows it. Calls are released in the order
   * they were scheduled.
   *
   * A rejected task must not break the chain for everyone behind it, so the
   * internal queue swallows the rejection while the caller still receives it.
   */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const waitMs = this.lastStartedAt + this.minIntervalMs - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      this.lastStartedAt = Date.now();
      return task();
    });

    this.queue = result.catch(() => undefined);
    return result;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
