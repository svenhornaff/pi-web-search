import { after, describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { fetchWithRetry } from "../src/retry.ts";

const originalFetch = globalThis.fetch;

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

describe("fetchWithRetry()", () => {
  test("retries a 503 in-loop and returns the eventual success", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 503 });
      return new Response("ok", { status: 200 });
    });

    const response = await fetchWithRetry("https://example.com/", {}, { retries: 2, delayMs: 1 });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  });

  test("honors Retry-After on 429 instead of the default backoff", async () => {
    let calls = 0;
    const start = Date.now();
    stubFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response("ok", { status: 200 });
    });

    const response = await fetchWithRetry("https://example.com/", {}, { retries: 2, delayMs: 5000 });
    assert.equal(response.status, 200);
    assert.ok(Date.now() - start < 1000, "Retry-After: 0 should skip the 5s default backoff");
  });

  test("does not retry a non-retryable status", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return new Response(null, { status: 404 });
    });

    const response = await fetchWithRetry("https://example.com/", {}, { retries: 2, delayMs: 1 });
    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  });

  test("retries a transport-level failure and returns the eventual success", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed: ECONNRESET");
      return new Response("ok", { status: 200 });
    });

    const response = await fetchWithRetry("https://example.com/", {}, { retries: 2, delayMs: 1 });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  });

  test("gives up after exhausting retries on a retryable status", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return new Response(null, { status: 503 });
    });

    const response = await fetchWithRetry("https://example.com/", {}, { retries: 1, delayMs: 1 });
    assert.equal(response.status, 503);
    assert.equal(calls, 2);
  });

  test("does not retry a transport-level failure once retries are exhausted", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      throw new Error("network timeout");
    });

    await assert.rejects(
      () => fetchWithRetry("https://example.com/", {}, { retries: 1, delayMs: 1 }),
      /timeout/,
    );
    assert.equal(calls, 2);
  });
});

after(() => {
  globalThis.fetch = originalFetch;
});
