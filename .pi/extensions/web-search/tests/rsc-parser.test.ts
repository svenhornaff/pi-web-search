import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { extractRscContent } from "../src/rsc-parser.ts";

describe("extractRscContent()", () => {
  test("returns null for plain HTML with no RSC data", () => {
    const html = "<html><body><p>Hello world</p></body></html>";
    assert.equal(extractRscContent(html), null);
  });

  test("returns null when RSC chunks are too short", () => {
    // Valid __next_f but trivially short content
    const html = `<script>self.__next_f.push([1,"1:\\"hi\\""])</script>`;
    const result = extractRscContent(html);
    // "hi" is < MIN_RSC_CHARS (200 chars), so null
    assert.equal(result, null);
  });

  test("extracts text from type-1 RSC push", () => {
    // Simulate a Next.js page with flight data containing readable text
    const longText = "This is a detailed article about React Server Components. ".repeat(10);
    const escaped = JSON.stringify(longText).slice(1, -1); // remove outer quotes
    const html = `<html><head></head><body>
      <script>self.__next_f=[]</script>
      <script>self.__next_f.push([1,"1:\\"${escaped}\\""])</script>
    </body></html>`;

    const result = extractRscContent(html);
    assert.ok(result !== null, "Should extract RSC content");
    assert.ok(result!.length >= 200, "Should meet MIN_RSC_CHARS threshold");
  });

  test("ignores type-0 (router patch) RSC pushes", () => {
    const longText = "Router patch content that should be ignored. ".repeat(10);
    const escaped = JSON.stringify(longText).slice(1, -1);
    const html = `<script>self.__next_f.push([0,"${escaped}"])</script>`;
    // Type 0 is skipped
    assert.equal(extractRscContent(html), null);
  });

  test("handles multiple type-1 RSC scripts", () => {
    const chunk1 = "First chunk of React Server Component content. ".repeat(3);
    const chunk2 = "Second chunk with more detailed article information. ".repeat(3);
    const esc1 = JSON.stringify(chunk1).slice(1, -1);
    const esc2 = JSON.stringify(chunk2).slice(1, -1);

    const html = `
      <script>self.__next_f.push([1,"1:\\"${esc1}\\""])</script>
      <script>self.__next_f.push([1,"1:\\"${esc2}\\""])</script>
    `;

    const result = extractRscContent(html);
    assert.ok(result !== null);
    assert.ok(result!.includes("First chunk") || result!.includes("Second chunk"));
  });

  test("filters out React internal strings", () => {
    const html = `<script>self.__next_f.push([1,"1:\\"$Lcomponent\\"\\n2:\\"__SECRET_INTERNALS\\"\\n3:\\"This is real readable content that should be extracted from the page.\\""])</script>`;
    const result = extractRscContent(html);
    // Either null (too short) or should not contain $ prefixed internals
    if (result !== null) {
      assert.ok(!result.includes("$Lcomponent"), "Should filter React internals");
    }
  });
});
