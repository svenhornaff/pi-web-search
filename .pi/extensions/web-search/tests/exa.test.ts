import { describe, test, after } from "node:test";
import { strict as assert } from "node:assert";
import { ExaProvider } from "../src/providers/exa.ts";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

const SAMPLE_RESPONSE = {
  requestId: "test-req-id",
  results: [
    {
      title: "Understanding LLM Attention",
      url: "https://arxiv.org/abs/2301.00001",
      text: "Large language models use attention mechanisms to process context. This paper explains transformer attention in detail.",
      summary: "An in-depth look at transformer attention mechanisms in LLMs.",
      publishedDate: "2024-01-15T00:00:00.000Z",
      author: "Test Author",
    },
    {
      title: "Neural Search Explained",
      url: "https://example.com/neural-search",
      text: "Neural search uses embeddings to find semantically similar content.",
    },
  ],
};

describe("ExaProvider — search contracts", () => {
  test("sends POST to api.exa.ai/search with correct headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    stubFetch(async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new ExaProvider("test-exa-key");
    await provider.search("LLM attention mechanisms");

    assert.match(capturedUrl, /api\.exa\.ai\/search/);
    assert.equal(capturedInit?.method, "POST");
    assert.equal((capturedInit?.headers as Record<string, string>)["x-api-key"], "test-exa-key");
    assert.equal((capturedInit?.headers as Record<string, string>)["Content-Type"], "application/json");
  });

  test("maps results to SearchResult shape", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = new ExaProvider("test-exa-key");
    const result = await provider.search("LLM attention");

    assert.equal(result.provider, "exa");
    assert.equal(result.query, "LLM attention");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0]?.title, "Understanding LLM Attention");
    assert.equal(result.results[0]?.url, "https://arxiv.org/abs/2301.00001");
  });

  test("prefers summary as description when present", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = new ExaProvider("test-exa-key");
    const result = await provider.search("LLM attention");

    assert.match(result.results[0]?.description ?? "", /in-depth look/);
  });

  test("falls back to text snippet when no summary", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = new ExaProvider("test-exa-key");
    const result = await provider.search("neural search");

    // Second result has no summary — should use text slice
    assert.match(result.results[1]?.description ?? "", /Neural search/);
  });

  test("exposes text as fullContent", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify(SAMPLE_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = new ExaProvider("test-exa-key");
    const result = await provider.search("LLM");

    assert.ok(result.results[0]?.fullContent?.includes("attention mechanisms"));
  });

  test("respects maxResults option", async () => {
    let capturedBody = "";

    stubFetch(async (_, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new ExaProvider("test-exa-key");
    await provider.search("test", { maxResults: 10 });

    const body = JSON.parse(capturedBody) as { numResults: number };
    assert.equal(body.numResults, 10);
  });

  test("caps numResults at 20", async () => {
    let capturedBody = "";

    stubFetch(async (_, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new ExaProvider("test-exa-key");
    await provider.search("test", { maxResults: 99 });

    const body = JSON.parse(capturedBody) as { numResults: number };
    assert.equal(body.numResults, 20);
  });

  test("adds startPublishedDate for freshness: 'week'", async () => {
    let capturedBody = "";

    stubFetch(async (_, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const before = Date.now();
    const provider = new ExaProvider("test-exa-key");
    await provider.search("test", { freshness: "week" });

    const body = JSON.parse(capturedBody) as { startPublishedDate: string };
    assert.ok(typeof body.startPublishedDate === "string");
    const cutoff = new Date(body.startPublishedDate).getTime();
    const expectedCutoff = before - 7 * 24 * 60 * 60 * 1000;
    // Allow 5 seconds of clock skew in the test
    assert.ok(Math.abs(cutoff - expectedCutoff) < 5000);
  });

  test("throws on HTTP error status", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = new ExaProvider("bad-key");
    await assert.rejects(
      () => provider.search("test"),
      /Exa Search API 401/,
    );
  });

  test("filters results missing title or url", async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: "Good result", url: "https://good.example.com", text: "content" },
            { url: "https://no-title.example.com" }, // no title
            { title: "No URL result" }, // no url
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    );

    const provider = new ExaProvider("test-exa-key");
    const result = await provider.search("test");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.title, "Good result");
  });

  test("handles empty results array gracefully", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = new ExaProvider("test-exa-key");
    const result = await provider.search("obscure query");
    assert.equal(result.results.length, 0);
    assert.equal(result.provider, "exa");
  });
});
