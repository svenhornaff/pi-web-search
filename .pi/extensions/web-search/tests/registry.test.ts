import { describe, test, after } from "node:test";
import { strict as assert } from "node:assert";
import { ProviderRegistry } from "../src/providers/registry.ts";
import type { SearchResponse } from "../src/providers/base.ts";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

/** Build a mock SearchProvider that resolves or rejects on demand. */
function mockProvider(
  name: string,
  behavior: "succeed" | "fail",
  response?: Partial<SearchResponse>,
) {
  return {
    name,
    type: "contextual" as const,
    async search(): Promise<SearchResponse> {
      if (behavior === "fail") throw new Error(`${name} failed`);
      return {
        results: response?.results ?? [{ title: name, url: `https://${name}.example.com`, description: name }],
        query: "test",
        provider: name,
      };
    },
  };
}

describe("ProviderRegistry.searchWithFallback()", () => {
  test("returns first provider result when it succeeds", async () => {
    const reg = new ProviderRegistry();
    reg.register("brave", mockProvider("brave", "succeed", {
      results: [{ title: "Brave result", url: "https://brave.example.com", description: "brave" }],
    }));

    const result = await reg.searchWithFallback(["brave"], "test query");
    assert.equal(result.provider, "brave");
    assert.equal(result.results[0]?.title, "Brave result");
  });

  test("falls through to second provider when first fails", async () => {
    const reg = new ProviderRegistry();
    reg.register("brave", mockProvider("brave", "fail"));
    reg.register("tavily", mockProvider("tavily", "succeed", {
      results: [{ title: "Tavily result", url: "https://tavily.example.com", description: "tavily" }],
    }));

    const result = await reg.searchWithFallback(["brave", "tavily"], "test query");
    assert.equal(result.provider, "tavily");
    assert.equal(result.results[0]?.title, "Tavily result");
  });

  test("falls through multiple failing providers to reach success", async () => {
    const reg = new ProviderRegistry();
    reg.register("brave", mockProvider("brave", "fail"));
    reg.register("tavily", mockProvider("tavily", "fail"));

    // Register a custom third provider
    const thirdProvider = {
      name: "third",
      type: "contextual" as const,
      async search(): Promise<SearchResponse> {
        return { results: [{ title: "Third", url: "https://third.example.com", description: "third" }], query: "test", provider: "third" };
      },
    };
    // Use internal map directly via cast since test needs a custom name
    (reg as unknown as { providers: Map<string, unknown> }).providers.set("third", thirdProvider);

    const result = await reg.searchWithFallback(
      ["brave", "tavily", "third"] as Parameters<typeof reg.searchWithFallback>[0],
      "test query",
    );
    assert.equal(result.provider, "third");
  });

  test("throws when all providers fail", async () => {
    const reg = new ProviderRegistry();
    reg.register("brave", mockProvider("brave", "fail"));
    reg.register("tavily", mockProvider("tavily", "fail"));

    await assert.rejects(
      () => reg.searchWithFallback(["brave", "tavily"], "test query"),
      /tavily failed/, // last error propagated
    );
  });

  test("throws when provider list is empty", async () => {
    const reg = new ProviderRegistry();
    await assert.rejects(
      () => reg.searchWithFallback([], "test query"),
      /All providers failed/,
    );
  });

  test("single-entry chain with no fallback — fails fast on error", async () => {
    const reg = new ProviderRegistry();
    reg.register("brave", mockProvider("brave", "fail"));

    await assert.rejects(
      () => reg.searchWithFallback(["brave"], "test query"),
      /brave failed/,
    );
  });
});

describe("ProviderRegistry constructor", () => {
  test("new instance has brave and tavily registered", () => {
    const reg = new ProviderRegistry();
    assert.ok(reg.hasProvider("brave"));
    assert.ok(reg.hasProvider("tavily"));
  });

  test("getProviderNames returns both", () => {
    const reg = new ProviderRegistry();
    const names = reg.getProviderNames();
    assert.ok(names.includes("brave"));
    assert.ok(names.includes("tavily"));
  });
});
