import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { selectSections } from "../src/section-selector.ts";
import type { Section } from "../src/types.ts";
import type { TokenCounter } from "../src/token-counter.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Simple heuristic counter (1 token per character) for deterministic tests. */
const simpleCounter: TokenCounter = {
  mode: "heuristic",
  provider: "unknown",
  count: async (text: string) => text.length,
};

function makeSection(overrides: Partial<Section> & { id: string }): Section {
  return {
    title: overrides.id,
    level: 1,
    content: overrides.content ?? overrides.id,
    startLine: 0,
    tokens: 0,
    rank: 0,
    included: false,
    ...overrides,
  };
}

// ── Selection behaviour ───────────────────────────────────────────────────

describe("selectSections — greedy fill", () => {
  test("includes all sections when budget is large enough", async () => {
    const sections = [
      makeSection({ id: "a", tokens: 10, rank: 1, startLine: 0 }),
      makeSection({ id: "b", tokens: 10, rank: 2, startLine: 10 }),
    ];
    const result = await selectSections(sections, 100, simpleCounter);
    assert.equal(result.truncated, false);
    assert.equal(result.sections.filter((s) => s.included).length, 2);
  });

  test("excludes sections when budget is tight", async () => {
    const sections = [
      makeSection({ id: "a", tokens: 60, rank: 1, startLine: 0 }),
      makeSection({ id: "b", tokens: 60, rank: 2, startLine: 10 }),
    ];
    const result = await selectSections(sections, 70, simpleCounter);
    assert.equal(result.truncated, true);
    assert.equal(result.sections.filter((s) => s.included).length, 1);
  });

  test("picks higher-ranked section over lower-ranked", async () => {
    const sections = [
      makeSection({ id: "low", tokens: 50, rank: 1, startLine: 0 }),
      makeSection({ id: "high", tokens: 50, rank: 100, startLine: 10 }),
    ];
    const result = await selectSections(sections, 60, simpleCounter);
    const included = result.sections.filter((s) => s.included);
    assert.equal(included.length, 1);
    assert.equal(included[0]!.id, "high");
  });
});

// ── Rank sort (the bug from pdf-extractor's old copy) ─────────────────────

describe("selectSections — rank sort", () => {
  test("sections are selected by rank, not by original order", async () => {
    // Sections appear in document order: a(rank 1), b(rank 3), c(rank 2)
    // Budget only fits two — should pick b and c (ranks 3 and 2), not a and b.
    const sections = [
      makeSection({ id: "a", tokens: 10, rank: 1, startLine: 0 }),
      makeSection({ id: "b", tokens: 10, rank: 3, startLine: 10 }),
      makeSection({ id: "c", tokens: 10, rank: 2, startLine: 20 }),
    ];
    const result = await selectSections(sections, 25, simpleCounter);
    const included = result.sections.filter((s) => s.included);
    assert.equal(included.length, 2);
    const ids = included.map((s) => s.id).sort();
    assert.deepEqual(ids, ["b", "c"]);
  });
});

// ── Output ordering ───────────────────────────────────────────────────────

describe("selectSections — output order", () => {
  test("markdown is in original document order (by startLine)", async () => {
    const sections = [
      makeSection({ id: "z", content: "ZZZ", tokens: 5, rank: 1, startLine: 20 }),
      makeSection({ id: "a", content: "AAA", tokens: 5, rank: 2, startLine: 0 }),
    ];
    const result = await selectSections(sections, 100, simpleCounter);
    // "a" has startLine 0, "z" has startLine 20 → a should come first
    assert.equal(result.markdown, "AAA\n\nZZZ");
  });

  test("custom separator is used", async () => {
    const sections = [
      makeSection({ id: "a", content: "A", tokens: 5, rank: 1, startLine: 0 }),
      makeSection({ id: "b", content: "B", tokens: 5, rank: 2, startLine: 10 }),
    ];
    const result = await selectSections(sections, 100, simpleCounter, "\n\n---\n\n");
    assert.equal(result.markdown, "A\n\n---\n\nB");
  });
});

// ── Token counts ──────────────────────────────────────────────────────────

describe("selectSections — token metadata", () => {
  test("totalTokens is sum of all sections", async () => {
    const sections = [
      makeSection({ id: "a", tokens: 30, rank: 1, startLine: 0 }),
      makeSection({ id: "b", tokens: 70, rank: 2, startLine: 10 }),
    ];
    const result = await selectSections(sections, 50, simpleCounter);
    assert.equal(result.totalTokens, 100);
  });

  test("returnedTokens is exact count from counter", async () => {
    const sections = [
      makeSection({ id: "a", content: "hello", tokens: 5, rank: 1, startLine: 0 }),
    ];
    const result = await selectSections(sections, 100, simpleCounter);
    // simpleCounter counts characters: "hello" = 5
    assert.equal(result.returnedTokens, 5);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe("selectSections — edge cases", () => {
  test("empty sections array", async () => {
    const result = await selectSections([], 100, simpleCounter);
    assert.equal(result.markdown, "");
    assert.equal(result.truncated, false);
    assert.equal(result.totalTokens, 0);
  });

  test("zero budget excludes everything", async () => {
    const sections = [
      makeSection({ id: "a", tokens: 10, rank: 1, startLine: 0 }),
    ];
    const result = await selectSections(sections, 0, simpleCounter);
    assert.equal(result.truncated, true);
    assert.equal(result.sections.filter((s) => s.included).length, 0);
  });
});
