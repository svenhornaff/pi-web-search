/**
 * Documentation consistency gate.
 *
 * Parses the fenced JSON examples from:
 *   - README.md  (Configuration section)
 *   - config.ts  (JSDoc header comment)
 *
 * and asserts that the fields they show match the actual DEFAULTS in config.ts.
 *
 * When the defaults change, this test fails — forcing a doc update before
 * check passes. Same class of drift-prevention as check-version.mjs and
 * surface.test.ts. (~40 LOC)
 */

import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");

/**
 * Extract the first fenced JSON block from a string.
 * Handles both plain markdown blocks and JSDoc-comment blocks
 * (where each line is prefixed with ` * `).
 */
function extractFirstJsonBlock(source: string): Record<string, unknown> {
  // Plain fenced block
  const plain = source.match(/```json\s*\n([\s\S]*?)\n```/);
  if (plain?.[1]) return JSON.parse(plain[1]) as Record<string, unknown>;

  // JSDoc-prefixed block: lines look like " * {\n * ...\n * }"
  const jsdoc = source.match(/```json\s*\n([\s\S]*?)\n[ \t]*\*[ \t]*```/);
  if (jsdoc?.[1]) {
    // Strip leading " * " from each line
    const stripped = jsdoc[1]
      .split("\n")
      .map((l) => l.replace(/^[ \t]*\*[ \t]?/, ""))
      .join("\n");
    return JSON.parse(stripped) as Record<string, unknown>;
  }

  throw new Error("No fenced JSON block found");
}

describe("doc-consistency — README and config.ts examples match DEFAULTS", () => {
  test("README Configuration example uses the current default fallbackOrder", async () => {
    const readme = await readFile(resolve(ROOT, "README.md"), "utf-8");
    const configSection = readme.slice(readme.indexOf("## Configuration"));
    const example = extractFirstJsonBlock(configSection);

    assert.deepEqual(
      example["fallbackOrder"],
      ["brave", "exa", "tavily"],
      "README fallbackOrder example must match DEFAULTS.fallbackOrder",
    );
    assert.equal(example["defaultProvider"], "auto");
    assert.equal(example["maxResults"], 5);
    assert.equal(example["maxInlineContentChars"], 30000);
  });

  test("config.ts JSDoc example uses the current default fallbackOrder", async () => {
    const src = await readFile(resolve(ROOT, "src", "config.ts"), "utf-8");
    const example = extractFirstJsonBlock(src);

    assert.deepEqual(
      example["fallbackOrder"],
      ["brave", "exa", "tavily"],
      "config.ts JSDoc example must match DEFAULTS.fallbackOrder",
    );
    assert.equal(example["defaultProvider"], "auto");
    assert.equal(example["maxResults"], 5);
    assert.equal(example["maxInlineContentChars"], 30000);
  });
});
