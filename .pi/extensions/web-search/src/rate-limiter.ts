/**
 * Token-bucket rate limiter for per-provider request throttling.
 *
 * Each provider has a configurable request-per-second limit.
 * Callers await `acquire()` before firing a request; the limiter delays
 * the call if the bucket is empty, then releases the token after the
 * minimum inter-request interval.
 *
 * Defaults (conservative, within free-tier limits):
 *   Brave:  1 req/s   (documented 1 req/s on free tier)
 *   Tavily: 5 req/s   (no published hard limit; conservative default)
 *   Exa:    5 req/s   (no published hard limit; conservative default)
 *
 * The limiter is per-ProviderRegistry-instance, not global, so tests that
 * construct isolated ProviderRegistry instances don't interfere.
 */

export interface RateLimiterOptions {
  /** Maximum requests per second */
  requestsPerSecond: number;
}

export class RateLimiter {
  private readonly minIntervalMs: number;
  private lastFiredAt = 0;
  private queue: Array<() => void> = [];
  private draining = false;

  constructor(options: RateLimiterOptions) {
    this.minIntervalMs = 1000 / Math.max(0.001, options.requestsPerSecond);
  }

  /**
   * Acquire a rate-limit token. Resolves when it is safe to fire a request.
   * Callers should await this before every provider API call.
   *
   * If `signal` is provided and already aborted, rejects immediately.
   * If `signal` fires while queued, the waiter is removed from the queue
   * and the promise rejects — no request fires for a cancelled caller.
   */
  acquire(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const resolver = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };

      const onAbort = () => {
        const idx = this.queue.indexOf(resolver);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(resolver);
      if (!this.draining) {
        this.drain();
      }
    });
  }

  private drain(): void {
    this.draining = true;
    const next = this.queue.shift();
    if (!next) {
      this.draining = false;
      return;
    }

    const now = Date.now();
    const waitMs = Math.max(0, this.minIntervalMs - (now - this.lastFiredAt));

    setTimeout(() => {
      this.lastFiredAt = Date.now();
      next();
      this.drain();
    }, waitMs);
  }
}

/** Per-provider rate limit defaults (requests per second) */
export const DEFAULT_RATE_LIMITS: Record<string, number> = {
  brave: 1,
  tavily: 5,
  exa: 5,
};
