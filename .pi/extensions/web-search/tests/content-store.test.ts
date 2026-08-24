import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { ContentStore } from "../src/content-store.ts";

describe("ContentStore", () => {
  test("store() returns a unique handle", () => {
    const store = new ContentStore();
    const h1 = store.store("https://a.com", "content a");
    const h2 = store.store("https://b.com", "content b");
    assert.ok(h1 !== h2);
    assert.ok(typeof h1 === "string" && h1.length > 0);
  });

  test("get() returns stored content", () => {
    const store = new ContentStore();
    const handle = store.store("https://example.com", "# Hello\n\nWorld", "Example");
    const entry = store.get(handle);
    assert.ok(entry);
    assert.equal(entry?.url, "https://example.com");
    assert.equal(entry?.markdown, "# Hello\n\nWorld");
    assert.equal(entry?.title, "Example");
  });

  test("get() returns null for unknown handle", () => {
    const store = new ContentStore();
    assert.equal(store.get("unknown"), null);
  });

  test("size() reflects stored entries", () => {
    const store = new ContentStore();
    assert.equal(store.size(), 0);
    store.store("https://a.com", "a");
    assert.equal(store.size(), 1);
    store.store("https://b.com", "b");
    assert.equal(store.size(), 2);
  });

  test("clear() removes all entries and resets counter", () => {
    const store = new ContentStore();
    store.store("https://a.com", "a");
    store.store("https://b.com", "b");
    store.clear();
    assert.equal(store.size(), 0);
    // Counter reset: next handle starts from wf1 again
    const h = store.store("https://c.com", "c");
    assert.equal(h, "wf1");
  });

  test("list() returns all live entries", () => {
    const store = new ContentStore();
    store.store("https://a.com", "a", "Title A");
    store.store("https://b.com", "b");
    const items = store.list();
    assert.equal(items.length, 2);
    assert.ok(items.some((i) => i.url === "https://a.com" && i.title === "Title A"));
    assert.ok(items.some((i) => i.url === "https://b.com"));
  });

  test("evictExpired() removes entries older than TTL", async () => {
    const store = new ContentStore();
    // Manually set storedAt to be old
    const handle = store.store("https://old.com", "old content");
    const entry = (store as unknown as { entries: Map<string, { storedAt: number }> }).entries.get(handle);
    if (entry) entry.storedAt = Date.now() - 31 * 60 * 1000; // 31 min ago

    store.evictExpired();
    assert.equal(store.size(), 0);
    assert.equal(store.get(handle), null);
  });

  test("handles are sequential and predictable", () => {
    const store = new ContentStore();
    const h1 = store.store("https://a.com", "a");
    const h2 = store.store("https://b.com", "b");
    const h3 = store.store("https://c.com", "c");
    assert.equal(h1, "wf1");
    assert.equal(h2, "wf2");
    assert.equal(h3, "wf3");
  });
});
