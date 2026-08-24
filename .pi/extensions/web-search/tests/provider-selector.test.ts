import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { suggestProvider } from "../src/provider-selector.ts";

// ── Tavily patterns ───────────────────────────────────────────────────────

describe("routes to tavily", () => {
  // comparison keywords
  const comparisons = [
    "compare Pydantic v1 vs v2",
    "FastAPI vs Django performance",
    "uv versus poetry packaging",
    "benchmark asyncio vs trio",
    "difference between pip and uv",
    "FastAPI vs. Starlette",       // vs. with dot
  ];
  for (const q of comparisons) {
    test(`comparison: "${q}"`, () => assert.equal(suggestProvider(q), "tavily"));
  }

  // depth/guide keywords
  const depth = [
    "comprehensive guide to uv workspaces",
    "complete guide Python packaging 2026",
    "deep dive into asyncio internals",
    "in-depth overview of Rust lifetimes",
    "in depth analysis of FastAPI",
    "overview of Python async frameworks",
  ];
  for (const q of depth) {
    test(`depth: "${q}"`, () => assert.equal(suggestProvider(q), "tavily"));
  }

  // understanding keywords
  const understanding = [
    "best practices for FastAPI auth",
    "how does the GIL work in Python",
    "explain Python descriptors",
    "understand asyncio event loop",
  ];
  for (const q of understanding) {
    test(`understanding: "${q}"`, () => assert.equal(suggestProvider(q), "tavily"));
  }
});

// ── Brave patterns ────────────────────────────────────────────────────────

describe("routes to brave", () => {
  const timeSensitive = [
    "latest FastAPI release",
    "newest Python version",
    "just released uv 0.8",
    "what's new in Python 3.13",
    "what is new in Pydantic v3",
    "breaking changes Django 5",
    "recent uv changelog",
    "FastAPI release notes",
    "FastAPI changelog",
  ];
  for (const q of timeSensitive) {
    test(`time-sensitive: "${q}"`, () => assert.equal(suggestProvider(q), "brave"));
  }
});

// ── Default (brave) ───────────────────────────────────────────────────────

describe("defaults to brave", () => {
  const generic = [
    "configure pyproject.toml uv",
    "FastAPI Pydantic v2 migration",
    "uv workspace setup",
    "Python type hints tutorial",
    "",
    "   ",
  ];
  for (const q of generic) {
    test(`generic: "${q || "(empty)"}"`, () => assert.equal(suggestProvider(q), "brave"));
  }
});

// ── Case insensitivity ────────────────────────────────────────────────────

describe("case insensitive", () => {
  test("COMPARE uppercase", () => assert.equal(suggestProvider("COMPARE Python frameworks"), "tavily"));
  test("LATEST uppercase",  () => assert.equal(suggestProvider("LATEST FastAPI release"),    "brave"));
  test("Mixed case",        () => assert.equal(suggestProvider("Best Practices FastAPI"),    "tavily"));
});

// ── Precedence (tavily patterns checked first) ────────────────────────────

describe("precedence", () => {
  test("tavily pattern wins over brave when both match", () => {
    // "latest" would be brave, but "compare" is checked first → tavily
    const q = "compare latest Python frameworks";
    assert.equal(suggestProvider(q), "tavily");
  });
});
