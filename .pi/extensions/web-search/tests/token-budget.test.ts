import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildBudget, buildUnknownBudget, effectiveContentBudget, UNKNOWN_DEFAULTS } from "../src/token-budget.ts";

// ── buildBudget ratio math ────────────────────────────────────────────────

describe("buildBudget — ratio math", () => {
  test("maxContentTokens = (ctx − output − 5% tool) × 0.95", () => {
    // 1M context, 128K output
    const b = buildBudget("test-model", 1_000_000, 128_000, "anthropic");
    // toolReserve = 1_000_000 * 0.05 = 50_000
    // (1_000_000 − 128_000 − 50_000) × 0.95 = 822_000 × 0.95 = 780_900
    assert.equal(b.maxContentTokens, 780_900);
  });

  test("128k context model", () => {
    const b = buildBudget("gpt-4o", 128_000, 16_384, "openai");
    // toolReserve = 128_000 * 0.05 = 6_400
    // (128_000 − 16_384 − 6_400) × 0.95 = 105_216 × 0.95 = 99_955.2 → 99_955
    assert.equal(b.maxContentTokens, 99_955);
  });

  test("small context model", () => {
    const b = buildBudget("small", 8_000, 2_000, "unknown");
    // toolReserve = 8_000 * 0.05 = 400
    // (8_000 − 2_000 − 400) × 0.95 = 5_600 × 0.95 = 5_320
    assert.equal(b.maxContentTokens, 5_320);
  });

  test("maxContentTokens cannot be negative", () => {
    // Edge case: outputReserve > contextWindow
    const b = buildBudget("edge", 10_000, 20_000, "unknown");
    assert.ok(b.maxContentTokens >= 0, "should clamp to 0");
  });
});

// ── Provider normalisation ────────────────────────────────────────────────

describe("buildBudget — provider normalisation", () => {
  test("anthropic → anthropic", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "anthropic").provider, "anthropic");
  });

  test("amazon-bedrock → anthropic", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "amazon-bedrock").provider, "anthropic");
  });

  test("openai → openai", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "openai").provider, "openai");
  });

  test("deepseek → openai", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "deepseek").provider, "openai");
  });

  test("groq → openai", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "groq").provider, "openai");
  });

  test("google → google", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "google").provider, "google");
  });

  test("google-vertex → google", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "google-vertex").provider, "google");
  });

  test("random-provider → unknown", () => {
    assert.equal(buildBudget("m", 100_000, 4_000, "some-other").provider, "unknown");
  });
});

// ── buildUnknownBudget ────────────────────────────────────────────────────

describe("buildUnknownBudget", () => {
  test("uses conservative 100k context window", () => {
    const b = buildUnknownBudget();
    assert.equal(b.contextWindow, UNKNOWN_DEFAULTS.contextWindow);
    assert.equal(b.contextWindow, 100_000);
  });

  test("model defaults to 'unknown'", () => {
    assert.equal(buildUnknownBudget().model, "unknown");
  });

  test("accepts custom model name", () => {
    assert.equal(buildUnknownBudget("my-model").model, "my-model");
  });

  test("maxContentTokens is positive and < contextWindow", () => {
    const b = buildUnknownBudget();
    assert.ok(b.maxContentTokens > 0);
    assert.ok(b.maxContentTokens < b.contextWindow);
  });
});

// ── effectiveContentBudget ─────────────────────────────────────────────────

describe("effectiveContentBudget", () => {
  const budget = buildBudget("test", 1_000_000, 128_000, "anthropic");
  // budget.maxContentTokens = 780_900

  test("returns static budget when usedTokens is null", () => {
    assert.equal(effectiveContentBudget(budget, null), budget.maxContentTokens);
  });

  test("returns static budget when usedTokens is undefined", () => {
    assert.equal(effectiveContentBudget(budget, undefined), budget.maxContentTokens);
  });

  test("reduces budget when session has consumed tokens", () => {
    // Used 800K of 1M context, output reserve is 128K → available = 72K
    const effective = effectiveContentBudget(budget, 800_000);
    assert.equal(effective, 72_000);
  });

  test("never exceeds static maxContentTokens even when session is empty", () => {
    const effective = effectiveContentBudget(budget, 0);
    // available = 1M - 0 - 128K = 872K, but capped at maxContentTokens (780_900)
    assert.equal(effective, budget.maxContentTokens);
  });

  test("returns 0 when session is completely full", () => {
    const effective = effectiveContentBudget(budget, 1_000_000);
    assert.equal(effective, 0);
  });

  test("returns 0 when usedTokens exceeds contextWindow", () => {
    const effective = effectiveContentBudget(budget, 1_200_000);
    assert.equal(effective, 0);
  });
});

// ── Returned shape ────────────────────────────────────────────────────────

describe("returned ModelBudget shape", () => {
  test("always includes all required fields", () => {
    for (const [ctx, out, prov] of [
      [1_000_000, 128_000, "anthropic"],
      [128_000, 16_384, "openai"],
      [100_000, 4_000, "unknown"],
    ] as const) {
      const b = buildBudget("m", ctx, out, prov);
      assert.ok("provider" in b, `missing provider`);
      assert.ok("model" in b, `missing model`);
      assert.ok("contextWindow" in b, `missing contextWindow`);
      assert.ok("outputReserve" in b, `missing outputReserve`);
      assert.ok("toolReserve" in b, `missing toolReserve`);
      assert.ok("safetyMargin" in b, `missing safetyMargin`);
      assert.ok("maxContentTokens" in b, `missing maxContentTokens`);
    }
  });

  test("model field echoes the input string", () => {
    assert.equal(buildBudget("claude-opus-4.7", 1_000_000, 128_000, "anthropic").model, "claude-opus-4.7");
    assert.equal(buildBudget("my-custom-model", 100_000, 4_000, "unknown").model, "my-custom-model");
  });

  test("outputReserve equals maxTokens input", () => {
    const b = buildBudget("m", 200_000, 32_000, "anthropic");
    assert.equal(b.outputReserve, 32_000);
  });
});
