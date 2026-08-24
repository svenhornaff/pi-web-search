import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { processContent } from "../src/content-processor.ts";
import { buildUnknownBudget } from "../src/token-budget.ts";
import type { TokenCounter } from "../src/token-counter.ts";

const counter: TokenCounter = {
  mode: "heuristic",
  provider: "unknown",
  count: async (text: string) => text.length,
};

const htmlFixture = readFileSync(
  join(import.meta.dirname, "fixtures", "simple-article.html"),
  "utf8",
);

describe("content pipeline", () => {
  test("processContent extracts a readable article and keeps the main sections", async () => {
    const budget = { ...buildUnknownBudget(), maxContentTokens: 30_000 };
    const result = await processContent(
      htmlFixture,
      "https://example.com/fastapi-quickstart",
      budget,
      counter,
    );

    assert.match(result.summary, /FastAPI makes/i);
    assert.match(result.mainContent, /Install/i);
    assert.match(result.mainContent, /Hello World/i);
    assert.match(result.mainContent, /uvicorn/i);
    assert.equal(result.metadata.title, "FastAPI Quickstart");
    assert.equal(result.metadata.truncated, false);
  });
});
