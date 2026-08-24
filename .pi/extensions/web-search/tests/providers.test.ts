import { after, describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { BraveProvider } from "../src/providers/brave.ts";
import { TavilyProvider } from "../src/providers/tavily.ts";

const originalFetch = globalThis.fetch;

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

describe("provider search contracts", () => {
  test("BraveProvider parses search results from the API response", async () => {
    stubFetch(async (input) => {
      assert.match(String(input), /api.search.brave.com/);
      return new Response(JSON.stringify({
        web: {
          results: [
            { title: "FastAPI docs", url: "https://fastapi.tiangolo.com/", description: "Modern Python API framework" },
            { title: "FastAPI vs Flask", url: "https://example.com/flask", description: "Comparison article" },
          ],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new BraveProvider("test-brave-key");
    const result = await provider.search("FastAPI docs", { maxResults: 2 });

    assert.equal(result.provider, "brave");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0]?.title, "FastAPI docs");
  });

  test("TavilyProvider maps the raw payload into SearchResult objects", async () => {
    stubFetch(async (input, init) => {
      assert.match(String(input), /api.tavily.com/);
      // Phase E: api_key moved out of body into Authorization header
      const authHeader = (init?.headers as Record<string, string>)["Authorization"];
      assert.match(authHeader ?? "", /^Bearer /);
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      assert.equal(body["api_key"], undefined, "api_key must not appear in request body");
      return new Response(JSON.stringify({
        query: "FastAPI docs",
        answer: "FastAPI is a Python web framework.",
        results: [
          {
            title: "FastAPI Guide",
            url: "https://example.com/guide",
            content: "How to build APIs with FastAPI.",
            raw_content: "Detailed API guide",
          },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new TavilyProvider("test-tavily-key");
    const result = await provider.search("FastAPI docs", { maxResults: 1, depth: "basic" });

    assert.equal(result.provider, "tavily");
    assert.equal(result.results[0]?.title, "FastAPI Guide");
    assert.match(result.results[0]?.description ?? "", /AI Summary/);
    assert.equal(result.results[0]?.fullContent, "Detailed API guide");
  });
});

after(() => {
  globalThis.fetch = originalFetch;
});
