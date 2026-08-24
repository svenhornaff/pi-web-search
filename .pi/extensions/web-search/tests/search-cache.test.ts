import { test, describe, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { SearchCache } from "../src/search-cache.ts";
import type { SearchResult } from "../src/providers/base.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

const results: SearchResult[] = [
  { title: "A", url: "https://a.com", description: "desc a" },
  { title: "B", url: "https://b.com", description: "desc b" },
];

const opts = { maxResults: 5 };

// ── key() ─────────────────────────────────────────────────────────────────

describe("key()", () => {
  let cache: SearchCache;
  beforeEach(() => { cache = new SearchCache(); });

  test("same query + providers + options produces same key", () => {
    const k1 = cache.key("FastAPI", ["brave"], opts);
    const k2 = cache.key("FastAPI", ["brave"], opts);
    assert.equal(k1, k2);
  });

  test("provider order does not affect key", () => {
    const k1 = cache.key("FastAPI", ["brave", "tavily"], opts);
    const k2 = cache.key("FastAPI", ["tavily", "brave"], opts);
    assert.equal(k1, k2);
  });

  test("different queries produce different keys", () => {
    const k1 = cache.key("FastAPI", ["brave"], opts);
    const k2 = cache.key("Django",  ["brave"], opts);
    assert.notEqual(k1, k2);
  });

  test("different providers produce different keys", () => {
    const k1 = cache.key("FastAPI", ["brave"],  opts);
    const k2 = cache.key("FastAPI", ["tavily"], opts);
    assert.notEqual(k1, k2);
  });

  test("different options produce different keys", () => {
    const k1 = cache.key("FastAPI", ["brave"], { maxResults: 5  });
    const k2 = cache.key("FastAPI", ["brave"], { maxResults: 10 });
    assert.notEqual(k1, k2);
  });

  test("empty options still produces a key", () => {
    const k = cache.key("FastAPI", ["brave"], {});
    assert.ok(typeof k === "string" && k.length > 0);
  });
});

// ── get() / set() ─────────────────────────────────────────────────────────

describe("get() / set()", () => {
  let cache: SearchCache;
  beforeEach(() => { cache = new SearchCache(); });

  test("cold miss returns undefined", () => {
    assert.equal(cache.get("nonexistent"), undefined);
  });

  test("hit after set returns the same array reference", () => {
    const key = cache.key("q", ["brave"], opts);
    cache.set(key, results);
    assert.equal(cache.get(key), results);
  });

  test("overwrite: second set replaces first", () => {
    const key = cache.key("q", ["brave"], opts);
    const first:  SearchResult[] = [{ title: "1", url: "https://1.com", description: "d" }];
    const second: SearchResult[] = [{ title: "2", url: "https://2.com", description: "d" }];
    cache.set(key, first);
    cache.set(key, second);
    assert.equal(cache.get(key), second);
  });

  test("expired entry returns undefined and is removed", () => {
    const cache2 = new SearchCache();
    const key = cache2.key("q", ["brave"], opts);
    // Manually inject an already-expired entry
    (cache2 as unknown as { store: Map<string, { results: SearchResult[]; expiresAt: number }> })
      .store.set(key, { results, expiresAt: Date.now() - 1 });
    assert.equal(cache2.get(key), undefined);
    // Should have been cleaned up
    const store = (cache2 as unknown as { store: Map<string, unknown> }).store;
    assert.equal(store.has(key), false);
  });

  test("non-expired entry survives", () => {
    const key = cache.key("q", ["brave"], opts);
    cache.set(key, results);
    // Immediately readable — not expired
    assert.deepEqual(cache.get(key), results);
  });
});

// ── clear() ───────────────────────────────────────────────────────────────

describe("clear()", () => {
  test("clears all entries for a new session", () => {
    const cache = new SearchCache();
    const key = cache.key("q", ["brave"], opts);
    cache.set(key, results);

    assert.equal(cache.get(key), results);
    cache.clear();
    assert.equal(cache.get(key), undefined);
    assert.equal((cache as unknown as { store: Map<string, unknown> }).store.size, 0);
  });
});

// ── evictExpired() ────────────────────────────────────────────────────────

describe("evictExpired()", () => {
  test("removes expired entries, keeps fresh ones", () => {
    const cache = new SearchCache();
    const store = (cache as unknown as { store: Map<string, { results: SearchResult[]; expiresAt: number }> }).store;

    const freshKey   = "fresh";
    const expiredKey = "expired";

    store.set(freshKey,   { results, expiresAt: Date.now() + 60_000 });
    store.set(expiredKey, { results, expiresAt: Date.now() - 1 });

    cache.evictExpired();

    assert.equal(store.has(freshKey),   true,  "fresh entry should survive");
    assert.equal(store.has(expiredKey), false, "expired entry should be removed");
  });

  test("empty store does not throw", () => {
    const cache = new SearchCache();
    assert.doesNotThrow(() => cache.evictExpired());
  });

  test("multiple expired entries all removed", () => {
    const cache = new SearchCache();
    const store = (cache as unknown as { store: Map<string, { results: SearchResult[]; expiresAt: number }> }).store;

    for (let i = 0; i < 5; i++) {
      store.set(`key-${i}`, { results, expiresAt: Date.now() - 1 });
    }
    cache.evictExpired();
    assert.equal(store.size, 0);
  });
});
