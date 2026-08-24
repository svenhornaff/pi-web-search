/**
 * Tests for GitHub URL handler — matchGitHubUrl() and fetchGitHub() strategies.
 */
import { describe, test, after } from "node:test";
import { strict as assert } from "node:assert";
import { matchGitHubUrl, fetchGitHub } from "../src/github-handler.ts";

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

// ── matchGitHubUrl ─────────────────────────────────────────────────────────

describe("matchGitHubUrl()", () => {
  test("matches repo root", () => {
    const m = matchGitHubUrl("https://github.com/owner/repo");
    assert.ok(m);
    assert.equal(m?.owner, "owner");
    assert.equal(m?.repo, "repo");
    assert.equal(m?.type, undefined);
  });

  test("matches blob path", () => {
    const m = matchGitHubUrl("https://github.com/owner/repo/blob/main/src/index.ts");
    assert.ok(m);
    assert.equal(m?.type, "blob");
    assert.equal(m?.refPath, "main/src/index.ts");
  });

  test("matches tree path", () => {
    const m = matchGitHubUrl("https://github.com/owner/repo/tree/main/src");
    assert.ok(m);
    assert.equal(m?.type, "tree");
    assert.equal(m?.refPath, "main/src");
  });

  test("returns null for non-GitHub URLs", () => {
    assert.equal(matchGitHubUrl("https://example.com/owner/repo"), null);
    assert.equal(matchGitHubUrl("https://gitlab.com/owner/repo"), null);
  });

  test("returns null for GitHub non-content paths", () => {
    // Single segment (no repo)
    assert.equal(matchGitHubUrl("https://github.com/owner"), null);
  });

  test("handles .git suffix in URL", () => {
    const m = matchGitHubUrl("https://github.com/owner/repo.git");
    assert.ok(m);
    assert.equal(m?.owner, "owner");
    assert.equal(m?.repo, "repo");
  });
});

// ── fetchGitHub strategies ─────────────────────────────────────────────────

describe("fetchGitHub() — blob strategy (raw file)", () => {
  test("fetches raw TypeScript file from raw.githubusercontent.com", async () => {
    stubFetch(async (input) => {
      assert.match(String(input), /raw\.githubusercontent\.com/);
      return new Response("export const foo = 42;", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });

    const url = "https://github.com/owner/repo/blob/main/src/foo.ts";
    const match = matchGitHubUrl(url)!;
    const result = await fetchGitHub(url, match);

    assert.ok(result);
    assert.equal(result?.strategy, "raw");
    assert.match(result?.markdown ?? "", /export const foo/);
    assert.match(result?.markdown ?? "", /```typescript/);
  });

  test("returns markdown file content as-is (no code fence)", async () => {
    stubFetch(async () =>
      new Response("# Hello\n\nThis is a readme.", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );

    const url = "https://github.com/owner/repo/blob/main/README.md";
    const match = matchGitHubUrl(url)!;
    const result = await fetchGitHub(url, match);

    assert.ok(result);
    assert.match(result?.markdown ?? "", /# Hello/);
    // No code fence for markdown files
    assert.ok(!(result?.markdown ?? "").includes("```"));
  });

  test("returns null on non-ok response", async () => {
    stubFetch(async () => new Response("Not Found", { status: 404 }));
    const url = "https://github.com/owner/repo/blob/main/missing.ts";
    const match = matchGitHubUrl(url)!;
    const result = await fetchGitHub(url, match);
    assert.equal(result, null);
  });
});

describe("fetchGitHub() — tree strategy (directory listing)", () => {
  test("returns markdown table of directory contents", async () => {
    stubFetch(async (input) => {
      assert.match(String(input), /api\.github\.com/);
      return new Response(JSON.stringify([
        { name: "index.ts", type: "file", size: 1234 },
        { name: "utils", type: "dir" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const url = "https://github.com/owner/repo/tree/main/src";
    const match = matchGitHubUrl(url)!;
    const result = await fetchGitHub(url, match);

    assert.ok(result);
    assert.equal(result?.strategy, "api-tree");
    assert.match(result?.markdown ?? "", /index\.ts/);
    assert.match(result?.markdown ?? "", /utils/);
    assert.match(result?.markdown ?? "", /\| Name \| Type \| Size \|/);
  });

  test("returns null on API error", async () => {
    stubFetch(async () => new Response("Unauthorized", { status: 401 }));
    const url = "https://github.com/owner/repo/tree/main/src";
    const match = matchGitHubUrl(url)!;
    const result = await fetchGitHub(url, match);
    assert.equal(result, null);
  });
});

describe("fetchGitHub() — repo root strategy", () => {
  test("returns README content and file listing", async () => {
    let callCount = 0;
    stubFetch(async (input) => {
      callCount++;
      const url = String(input);
      if (url.includes("/readme")) {
        return new Response("# My Project\n\nA great project.", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      if (url.includes("/contents")) {
        return new Response(JSON.stringify([
          { name: "README.md", type: "file", size: 100 },
          { name: "src", type: "dir" },
        ]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });

    const url = "https://github.com/owner/repo";
    const match = matchGitHubUrl(url)!;
    const result = await fetchGitHub(url, match);

    assert.ok(result);
    assert.equal(result?.strategy, "api-readme");
    assert.match(result?.markdown ?? "", /# My Project/);
    assert.match(result?.markdown ?? "", /README\.md/);
    assert.match(result?.markdown ?? "", /## Repository Contents/);
    assert.equal(callCount, 2); // readme + contents fetched in parallel
  });

  test("returns null when both README and contents fail", async () => {
    stubFetch(async () => new Response("Unauthorized", { status: 401 }));
    const url = "https://github.com/owner/repo";
    const match = matchGitHubUrl(url)!;
    const result = await fetchGitHub(url, match);
    assert.equal(result, null);
  });
});
