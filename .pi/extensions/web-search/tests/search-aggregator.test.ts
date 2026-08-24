import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { aggregate } from "../src/search-aggregator.ts";
import type { SearchResponse } from "../src/providers/base.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

const brave: SearchResponse = {
  provider: "brave",
  query: "FastAPI async",
  results: [
    { title: "FastAPI Docs",    url: "https://fastapi.tiangolo.com/async/", description: "Brave snippet" },
    { title: "FastAPI GitHub",  url: "https://github.com/fastapi/fastapi",  description: "GitHub brave" },
    { title: "Brave only",      url: "https://example.com/brave-only",      description: "Only in brave" },
  ],
};

const tavily: SearchResponse = {
  provider: "tavily",
  query: "FastAPI async",
  results: [
    // Same as brave[0] — different protocol variant + trailing slash stripped
    { title: "FastAPI Async",   url: "http://www.fastapi.tiangolo.com/async", description: "Longer Tavily snippet about async in FastAPI", fullContent: "Full page content" },
    // Same as brave[1] — http + trailing slash
    { title: "FastAPI GitHub",  url: "http://github.com/fastapi/fastapi/",    description: "GitHub tavily" },
    { title: "Tavily only",     url: "https://example.com/tavily-only",       description: "Only in tavily" },
  ],
};

// ── URL normalisation (via aggregate behaviour) ───────────────────────────

describe("URL deduplication", () => {
  test("strips https protocol", () => {
    const r = aggregate([
      { provider: "a", query: "q", results: [{ title: "T", url: "https://example.com", description: "d" }] },
      { provider: "b", query: "q", results: [{ title: "T", url: "https://example.com", description: "d" }] },
    ]);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0]!.foundBy.length, 2);
  });

  test("strips http protocol", () => {
    const r = aggregate([
      { provider: "a", query: "q", results: [{ title: "T", url: "https://example.com", description: "d" }] },
      { provider: "b", query: "q", results: [{ title: "T", url: "http://example.com",  description: "d" }] },
    ]);
    assert.equal(r.results.length, 1);
  });

  test("strips www. prefix", () => {
    const r = aggregate([
      { provider: "a", query: "q", results: [{ title: "T", url: "https://example.com",     description: "d" }] },
      { provider: "b", query: "q", results: [{ title: "T", url: "https://www.example.com", description: "d" }] },
    ]);
    assert.equal(r.results.length, 1);
  });

  test("strips trailing slash", () => {
    const r = aggregate([
      { provider: "a", query: "q", results: [{ title: "T", url: "https://example.com/path",  description: "d" }] },
      { provider: "b", query: "q", results: [{ title: "T", url: "https://example.com/path/", description: "d" }] },
    ]);
    assert.equal(r.results.length, 1);
  });

  test("is case-insensitive", () => {
    const r = aggregate([
      { provider: "a", query: "q", results: [{ title: "T", url: "https://Example.COM/Path", description: "d" }] },
      { provider: "b", query: "q", results: [{ title: "T", url: "https://example.com/path", description: "d" }] },
    ]);
    assert.equal(r.results.length, 1);
  });

  test("all four variants at once (protocol + www + slash)", () => {
    const r = aggregate([brave, tavily]);
    // brave[0] and tavily[0] both point to fastapi.tiangolo.com/async — should merge
    assert.equal(r.meta.overlap.some(u => u.includes("tiangolo")), true);
    // brave[1] and tavily[1] both point to github.com/fastapi/fastapi — should merge
    assert.equal(r.meta.overlap.some(u => u.includes("github")), true);
    // brave-only and tavily-only remain distinct
    assert.equal(r.results.length, 4, "3 from each - 2 overlaps = 4 unique");
  });
});

// ── Merge strategy ────────────────────────────────────────────────────────

describe("merge strategy on collision", () => {
  test("prefers longer description", () => {
    const r = aggregate([brave, tavily]);
    const fastapi = r.results.find(x => x.url.toLowerCase().includes("tiangolo"));
    assert.ok(fastapi, "merged fastapi result should exist");
    assert.ok(fastapi!.description.length > "Brave snippet".length, "should keep the longer Tavily description");
    assert.match(fastapi!.description, /longer|Tavily/i);
  });

  test("prefers fullContent from Tavily when brave has none", () => {
    const r = aggregate([brave, tavily]);
    const fastapi = r.results.find(x => x.url.toLowerCase().includes("tiangolo"));
    assert.equal(fastapi!.fullContent, "Full page content");
  });

  test("does not overwrite existing fullContent", () => {
    const withContent: SearchResponse = {
      provider: "a", query: "q",
      results: [{ title: "T", url: "https://example.com", description: "short", fullContent: "existing" }],
    };
    const withMoreContent: SearchResponse = {
      provider: "b", query: "q",
      results: [{ title: "T", url: "https://example.com", description: "short", fullContent: "new content" }],
    };
    const r = aggregate([withContent, withMoreContent]);
    assert.equal(r.results[0]!.fullContent, "existing", "first fullContent wins");
  });
});

// ── Ranking ───────────────────────────────────────────────────────────────

describe("result ranking", () => {
  test("overlap results sort before single-provider results", () => {
    const r = aggregate([brave, tavily]);
    const overlapCount = r.results[0]!.foundBy.length;
    // Every result with foundBy.length > 1 must appear before results with foundBy.length === 1
    let seenSingle = false;
    for (const result of r.results) {
      if (result.foundBy.length === 1) seenSingle = true;
      if (seenSingle) assert.equal(result.foundBy.length, 1, "no multi-provider result after a single-provider result");
    }
    assert.ok(overlapCount > 1, "first result should be from multiple providers");
  });
});

// ── Metadata ─────────────────────────────────────────────────────────────

describe("metadata", () => {
  test("providers list matches input", () => {
    const r = aggregate([brave, tavily]);
    assert.deepEqual(r.meta.providers, ["brave", "tavily"]);
  });

  test("totalBeforeDedup is sum of all results", () => {
    const r = aggregate([brave, tavily]);
    assert.equal(r.meta.totalBeforeDedup, 6);
  });

  test("overlap only lists URLs found by more than one provider", () => {
    const r = aggregate([brave, tavily]);
    assert.equal(r.meta.overlap.length, 2);
    for (const url of r.meta.overlap) {
      const result = r.results.find(x => x.foundBy.length > 1);
      assert.ok(result, `overlap URL ${url} should map to a multi-provider result`);
    }
  });

  test("query taken from first response", () => {
    const r = aggregate([brave, tavily]);
    assert.equal(r.query, "FastAPI async");
  });

  test("empty responses returns empty result", () => {
    const r = aggregate([]);
    assert.equal(r.results.length, 0);
    assert.equal(r.query, "");
    assert.equal(r.meta.totalBeforeDedup, 0);
  });

  test("single provider returns no overlap", () => {
    const r = aggregate([brave]);
    assert.equal(r.meta.overlap.length, 0);
    assert.equal(r.results.length, 3);
    for (const result of r.results) {
      assert.deepEqual(result.foundBy, ["brave"]);
    }
  });
});
