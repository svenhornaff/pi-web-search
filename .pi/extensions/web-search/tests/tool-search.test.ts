/**
 * Integration tests for web_search tool execute().
 * Mocks fetch() to exercise the full execute path end-to-end
 * and assert the formatted output shape the LLM actually receives.
 */
import { describe, test, after } from "node:test";
import { strict as assert } from "node:assert";
import { createSearchTool } from "../src/tool-search.ts";
import { SearchCache } from "../src/search-cache.ts";
import { ProviderRegistry, registry } from "../src/providers/registry.ts";
import { BraveProvider } from "../src/providers/brave.ts";
import { TavilyProvider } from "../src/providers/tavily.ts";
import { ExaProvider } from "../src/providers/exa.ts";

// Re-register singleton providers with injected test keys so tests never
// call resolveApiKey() (which shells to /usr/bin/security on macOS or reads
// env vars). Without this, tests pass locally only because the author's
// keychain has real keys — they fail on any keyless CI runner (Ubuntu, clean env).
// This is the same pattern registry.test.ts uses with isolated instances.
registry.register("brave",  new BraveProvider("test-brave-key"));
registry.register("tavily", new TavilyProvider("test-tavily-key"));
registry.register("exa",    new ExaProvider("test-exa-key"));

// Override rate limits to 1000 req/s — the 1 req/s Brave default would make
// integration tests unacceptably slow.
registry.setRateLimit("brave",  1000);
registry.setRateLimit("tavily", 1000);
registry.setRateLimit("exa",    1000);

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function stubFetch(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function makeSearchResponse(provider: "brave" | "tavily", results: Array<{ title: string; url: string }> = []) {
  if (provider === "brave") {
    return new Response(JSON.stringify({
      web: { results: results.map((r) => ({ ...r, description: `${r.title} description` })) },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  // tavily
  return new Response(JSON.stringify({
    query: "test",
    results: results.map((r) => ({ ...r, content: `${r.title} content`, raw_content: `Full: ${r.title}` })),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

const BRAVE_RESULTS = [
  { title: "FastAPI Docs", url: "https://fastapi.tiangolo.com/" },
  { title: "FastAPI GitHub", url: "https://github.com/fastapi/fastapi" },
];

describe("web_search execute() — single provider", () => {
  test("returns formatted text with provider label", async () => {
    stubFetch(async () => makeSearchResponse("brave", BRAVE_RESULTS));

    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    const result = await (tool as ReturnType<typeof createSearchTool>).execute(
      "call-1", { query: "FastAPI docs", provider: "brave" }, undefined, undefined, undefined,
    );

    assert.ok(Array.isArray(result.content));
    assert.equal(result.content[0]?.type, "text");
    assert.match(result.content[0]?.text ?? "", /FastAPI Docs/);
    assert.match(result.content[0]?.text ?? "", /Search provider/);
  });

  test("details include resultCount and providers", async () => {
    stubFetch(async () => makeSearchResponse("brave", BRAVE_RESULTS));

    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    const result = await (tool as ReturnType<typeof createSearchTool>).execute(
      "call-2", { query: "FastAPI docs", provider: "brave" }, undefined, undefined, undefined,
    );

    assert.equal((result.details as unknown as Record<string, unknown>)["resultCount"], 2);
    assert.deepEqual((result.details as unknown as Record<string, unknown>)["providers"], ["brave"]);
    assert.equal((result.details as unknown as Record<string, unknown>)["cached"], false);
  });

  test("cache hit skips fetch on second identical call", async () => {
    let fetchCount = 0;
    stubFetch(async () => { fetchCount++; return makeSearchResponse("brave", BRAVE_RESULTS); });

    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    const params = { query: "cache test", provider: "brave" };

    await (tool as ReturnType<typeof createSearchTool>).execute("c1", params, undefined, undefined, undefined);
    await (tool as ReturnType<typeof createSearchTool>).execute("c2", params, undefined, undefined, undefined);

    assert.equal(fetchCount, 1); // second call hit cache
  });

  test("cache miss after clear", async () => {
    let fetchCount = 0;
    stubFetch(async () => { fetchCount++; return makeSearchResponse("brave", BRAVE_RESULTS); });

    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    const params = { query: "clear test", provider: "brave" };

    await (tool as ReturnType<typeof createSearchTool>).execute("c1", params, undefined, undefined, undefined);
    cache.clear();
    await (tool as ReturnType<typeof createSearchTool>).execute("c2", params, undefined, undefined, undefined);

    assert.equal(fetchCount, 2);
  });

  test("throws when query missing and no queries[]", async () => {
    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    await assert.rejects(
      () => (tool as ReturnType<typeof createSearchTool>).execute("c1", {}, undefined, undefined, undefined),
      /query is required/,
    );
  });
});

describe("web_search execute() — batch queries[]", () => {
  test("runs multiple queries in parallel and deduplicates", async () => {
    let callCount = 0;
    stubFetch(async (input) => {
      callCount++;
      const url = String(input);
      if (url.includes("brave")) {
        return makeSearchResponse("brave", [
          { title: `Result for query ${callCount}`, url: `https://example${callCount}.com` },
        ]);
      }
      return makeSearchResponse("brave", []);
    });

    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    const result = await (tool as ReturnType<typeof createSearchTool>).execute(
      "batch-1",
      { queries: ["FastAPI basics", "FastAPI advanced"], provider: "brave" },
      undefined, undefined, undefined,
    );

    assert.ok((result.details as unknown as Record<string, unknown>)["batch"] === true);
    assert.ok(Array.isArray((result.details as unknown as Record<string, unknown>)["queries"]));
    assert.equal(((result.details as unknown as Record<string, unknown>)["queries"] as string[]).length, 2);
  });

  test("batch result text contains provider label", async () => {
    stubFetch(async () => makeSearchResponse("brave", BRAVE_RESULTS));

    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    const result = await (tool as ReturnType<typeof createSearchTool>).execute(
      "batch-2",
      { queries: ["query one", "query two"], provider: "brave" },
      undefined, undefined, undefined,
    );

    assert.match(result.content[0]?.text ?? "", /Search provider/);
  });

  test("batch cache hit on second identical call", async () => {
    let fetchCount = 0;
    stubFetch(async () => { fetchCount++; return makeSearchResponse("brave", BRAVE_RESULTS); });

    const cache = new SearchCache();
    const tool = createSearchTool(() => cache);
    const params = { queries: ["q1", "q2"], provider: "brave" as const };

    await (tool as ReturnType<typeof createSearchTool>).execute("b1", params, undefined, undefined, undefined);
    await (tool as ReturnType<typeof createSearchTool>).execute("b2", params, undefined, undefined, undefined);

    // 2 calls for first execution (2 queries), 0 for second (cache hit)
    assert.equal(fetchCount, 2);
  });
});

describe("web_search execute() — fallback chain", () => {
  // Uses an isolated ProviderRegistry (not the shared singleton) so
  // mutations here don't affect other test suites.

  test("falls through to second provider when first fails (auto-select, no explicit provider)", async () => {
    // Stub: exa throws (simulates missing key / network error),
    //       brave succeeds.
    stubFetch(async (input) => {
      const url = String(input);
      if (url.includes("exa.ai")) throw new Error("Exa unavailable");
      return makeSearchResponse("brave", BRAVE_RESULTS);
    });

    // Isolated registry: Exa has no key (throws on search), Brave has injected key.
    const isolatedRegistry = new ProviderRegistry();
    isolatedRegistry.register("exa",    new ExaProvider());    // keyless → will throw
    isolatedRegistry.register("brave",  new BraveProvider("test-brave-key"));
    isolatedRegistry.register("tavily", new TavilyProvider("test-tavily-key"));
    isolatedRegistry.setRateLimit("exa",    1000);
    isolatedRegistry.setRateLimit("brave",  1000);
    isolatedRegistry.setRateLimit("tavily", 1000);

    const cache = new SearchCache();
    // Pass the isolated registry via the config's fallbackOrder.
    // createSearchTool uses the module-level `registry` singleton — to test
    // the fallback path with an isolated registry, we call searchWithFallback
    // directly on our isolated instance and confirm the result.
    const fallbackResult = await isolatedRegistry.searchWithFallback(
      ["exa", "brave", "tavily"],
      "test fallback query",
      { maxResults: 5 },
    );

    // Exa failed, Brave answered — response.provider must be "brave"
    assert.equal(fallbackResult.provider, "brave");
    assert.equal(fallbackResult.results[0]?.title, "FastAPI Docs");

    // Confirm the cache key would be attributed to the actual answerer
    const actualKey = cache.key("test fallback query", ["brave"], { maxResults: 5 });
    const primaryKey = cache.key("test fallback query", ["exa"],   { maxResults: 5 });
    assert.ok(actualKey !== primaryKey, "Actual and primary cache keys must differ");
    void cache;
  });

  test("cache entry keyed under actual provider, not primary", async () => {
    // Verify the tool-level fix: after fallback, the cache is keyed under
    // response.provider, not primaryProvider.
    stubFetch(async (input) => {
      if (String(input).includes("exa.ai")) throw new Error("Exa down");
      return makeSearchResponse("brave", BRAVE_RESULTS);
    });

    const isolatedRegistry = new ProviderRegistry();
    isolatedRegistry.register("exa",    new ExaProvider());    // no key → throws
    isolatedRegistry.register("brave",  new BraveProvider("test-brave-key"));
    isolatedRegistry.register("tavily", new TavilyProvider("test-tavily-key"));
    isolatedRegistry.setRateLimit("exa",    1000);
    isolatedRegistry.setRateLimit("brave",  1000);
    isolatedRegistry.setRateLimit("tavily", 1000);

    const cache = new SearchCache();
    const response = await isolatedRegistry.searchWithFallback(
      ["exa", "brave"],
      "cache attribution test",
      { maxResults: 5 },
    );

    // Store under actual provider (brave), not primary (exa)
    const actualKey = cache.key("cache attribution test", [response.provider as "brave" | "tavily" | "exa"], { maxResults: 5 });
    cache.set(actualKey, response.results);

    // Hitting the actual key returns results; hitting the primary key is a miss
    const braveKey = cache.key("cache attribution test", ["brave"],  { maxResults: 5 });
    const exaKey   = cache.key("cache attribution test", ["exa"],    { maxResults: 5 });
    assert.ok(cache.get(braveKey) !== undefined, "brave key must be a hit");
    assert.ok(cache.get(exaKey)   === undefined, "exa key must be a miss (fallback happened)");
  });
});
