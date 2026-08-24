import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { suggestProvider } from "../src/provider-selector.ts";

// ── Exa patterns (neural / semantic / research) ───────────────────────────

describe("routes to exa", () => {
  const research = [
    "research paper on transformers",
    "arxiv preprint LLM survey",
    "academic study on attention mechanisms",
    "survey of large language models",
    "literature review machine learning",
  ];
  for (const q of research) {
    test(`research: "${q}"`, () => assert.equal(suggestProvider(q), "exa"));
  }

  const conceptual = [
    "how does the GIL work in Python",
    "why do transformers use attention",
    "how does a neural network work",
    "explain Python descriptors",
    "understand asyncio event loop",
  ];
  for (const q of conceptual) {
    test(`conceptual: "${q}"`, () => assert.equal(suggestProvider(q), "exa"));
  }

  const aiTopics = [
    "machine learning inference optimization",
    "deep learning framework comparison",
    "neural network architecture design",
    "large language model fine-tuning",
    "LLM tokenization strategies",
    "transformer attention heads",
  ];
  for (const q of aiTopics) {
    test(`AI topic: "${q}"`, () => assert.equal(suggestProvider(q), "exa"));
  }
});

// ── Tavily patterns (deep research / full content) ────────────────────────

describe("routes to tavily", () => {
  const comparisons = [
    "compare Pydantic v1 vs v2",
    "FastAPI vs Django performance",
    "uv versus poetry packaging",
    "benchmark asyncio vs trio",
    "difference between pip and uv",
    "FastAPI vs. Starlette",
  ];
  for (const q of comparisons) {
    test(`comparison: "${q}"`, () => assert.equal(suggestProvider(q), "tavily"));
  }

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

  const guides = [
    "best practices for FastAPI auth",
    "step-by-step tutorial FastAPI",
    "getting started with uv",
  ];
  for (const q of guides) {
    test(`guide: "${q}"`, () => assert.equal(suggestProvider(q), "tavily"));
  }
});

// ── Brave patterns (time-sensitive / SERP) ────────────────────────────────

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
    "Python type hints",
    "",
    "   ",
  ];
  for (const q of generic) {
    test(`generic: "${q || "(empty)"}"`, () => assert.equal(suggestProvider(q), "brave"));
  }
});

// ── Case insensitivity ────────────────────────────────────────────────────

describe("case insensitive", () => {
  test("COMPARE uppercase → tavily", () => assert.equal(suggestProvider("COMPARE Python frameworks"), "tavily"));
  test("LATEST uppercase → brave",   () => assert.equal(suggestProvider("LATEST FastAPI release"), "brave"));
  test("RESEARCH PAPER uppercase → exa", () => assert.equal(suggestProvider("RESEARCH PAPER transformers"), "exa"));
  test("LLM uppercase → exa",        () => assert.equal(suggestProvider("LLM architecture overview"), "exa"));
});

// ── Precedence ────────────────────────────────────────────────────────────

describe("precedence", () => {
  test("exa pattern wins over tavily when both match", () => {
    // "research paper" (exa) + "comprehensive guide" (tavily) → exa wins (checked first)
    assert.equal(suggestProvider("comprehensive research paper survey"), "exa");
  });

  test("tavily pattern wins over brave when both match", () => {
    // "latest" (brave) + "compare" (tavily) → tavily wins (checked before brave)
    assert.equal(suggestProvider("compare latest Python frameworks"), "tavily");
  });

  test("exa pattern wins over brave", () => {
    // "neural network" (exa) + "latest" (brave) → exa wins
    assert.equal(suggestProvider("latest neural network research"), "exa");
  });
});
