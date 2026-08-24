import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { RateLimiter } from "../src/rate-limiter.ts";

describe("RateLimiter", () => {
  test("resolves immediately on first acquire", async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 100 });
    const start = Date.now();
    await limiter.acquire();
    assert.ok(Date.now() - start < 50, "first acquire should be near-instant");
  });

  test("enforces minimum interval between requests", async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 10 }); // 100ms interval
    const times: number[] = [];

    await limiter.acquire(); times.push(Date.now());
    await limiter.acquire(); times.push(Date.now());
    await limiter.acquire(); times.push(Date.now());

    // Each subsequent acquire should be at least ~80ms after the previous
    // (allow generous margin for test environment jitter)
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
      assert.ok(gap >= 80, `Expected gap >= 80ms, got ${gap}ms`);
    }
  });

  test("queues multiple waiters and resolves them in order", async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 50 }); // 20ms interval
    const order: number[] = [];

    // Start 3 acquires concurrently — they should resolve in submission order
    await Promise.all([
      limiter.acquire().then(() => order.push(1)),
      limiter.acquire().then(() => order.push(2)),
      limiter.acquire().then(() => order.push(3)),
    ]);

    assert.deepEqual(order, [1, 2, 3]);
  });

  test("high requestsPerSecond allows rapid successive calls", async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1000 });
    const start = Date.now();
    for (let i = 0; i < 5; i++) await limiter.acquire();
    assert.ok(Date.now() - start < 200, "5 acquires at 1000rps should finish quickly");
  });

  test("aborts immediately if signal is already aborted on entry", async () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1 });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => limiter.acquire(ac.signal),
      (err: Error) => err.name === "AbortError",
    );
  });

  test("aborts a queued waiter without blocking the queue", async () => {
    // 2 rps = 500ms interval; first acquire resolves immediately.
    // Second is queued and aborted — should reject before the interval elapses.
    const limiter = new RateLimiter({ requestsPerSecond: 2 });
    await limiter.acquire(); // prime the limiter

    const ac = new AbortController();
    const start = Date.now();

    // Queue the second acquire but abort it immediately
    const p = limiter.acquire(ac.signal);
    ac.abort();

    await assert.rejects(() => p, (err: Error) => err.name === "AbortError");
    // Should reject well before the 500ms interval
    assert.ok(Date.now() - start < 400, "Abort should resolve quickly, not wait for interval");
  });
});
