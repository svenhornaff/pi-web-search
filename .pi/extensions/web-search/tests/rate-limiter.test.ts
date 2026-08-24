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
});
