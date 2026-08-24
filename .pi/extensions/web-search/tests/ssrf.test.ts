import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { validateFetchUrl } from "../src/ssrf.ts";

describe("validateFetchUrl()", () => {
  test("accepts public HTTPS URLs", async () => {
    const url = await validateFetchUrl("https://example.com/path");
    assert.equal(url.hostname, "example.com");
  });

  test("rejects non-HTTPS schemes", async () => {
    await assert.rejects(() => validateFetchUrl("file:///tmp/test.txt"), /Only https:\/\//);
    await assert.rejects(() => validateFetchUrl("javascript:alert(1)"), /Only https:\/\//);
  });

  test("rejects localhost and local network targets", async () => {
    await assert.rejects(() => validateFetchUrl("https://localhost:3000"), /Localhost|Blocked network target/);
    await assert.rejects(() => validateFetchUrl("https://127.0.0.1"), /Blocked network target/);
  });
});
