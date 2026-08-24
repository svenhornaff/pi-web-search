/**
 * web-search — Dual-provider web search extension for Pi coding agent.
 *
 * Registers two tools the LLM calls autonomously:
 *   web_search  — search the web via Brave or Tavily
 *   web_fetch   — extract readable content from a URL
 *
 * Setup:
 *   1. Set BRAVE_API_KEY in your environment
 *   2. Place this extension in .pi/extensions/ (project) or ~/.pi/agent/extensions/ (global)
 *   3. Run `npm install` in this directory
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildBudget, buildUnknownBudget } from "./token-budget.js";
import { createTokenCounter } from "./token-counter.js";
import type { ModelBudget } from "./types.js";
import type { TokenCounter } from "./token-counter.js";
import { SearchCache } from "./search-cache.js";
import { createSearchTool } from "./tool-search.js";
import { createFetchTool } from "./tool-fetch.js";
import { createGetContentTool } from "./tool-get-content.js";
import { ContentStore } from "./content-store.js";
import { registry } from "./providers/registry.js";
import { suggestProvider } from "./provider-selector.js";
import { cleanExpiredSpillover } from "./spillover.js";
import { loadConfig, type WebSearchConfig } from "./config.js";

function renderSearchWidget(ctx: ExtensionContext, cache: SearchCache): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget("web-search-status", [
    "Web Search ready",
    `Cached results: ${cache.size()}`,
  ]);
}

export default function piWebSearch(pi: ExtensionAPI): void {
  // ── Mutable state (closure-scoped) ──────────────────────────────────────
  let budget: ModelBudget = buildUnknownBudget();
  let counter: TokenCounter = createTokenCounter("unknown", "unknown");
  const cache = new SearchCache();
  const store = new ContentStore();
  let config: WebSearchConfig | null = null;

  // ── Lifecycle events ────────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    cache.clear();
    store.clear();
    // Load (or reload) config each session — picks up edits without restarting Pi.
    loadConfig().then((cfg) => { config = cfg; }).catch(() => {});
    renderSearchWidget(ctx, cache);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    // Clean up expired spillover files on session end.
    // Fire-and-forget — shutdown must not block on async cleanup.
    cleanExpiredSpillover(ctx.cwd).catch(() => {});
  });

  pi.on("model_select", (event) => {
    const model = event.model;
    budget = buildBudget(
      model.id,
      model.contextWindow,
      model.maxTokens,
      model.provider,
    );
    counter = createTokenCounter(budget.provider, budget.model);
  });

  // ── Commands & shortcuts ───────────────────────────────────────────────
  pi.registerCommand("websearch", {
    description: "Run a quick web search or show the current extension status.",
    handler: async (args, ctx) => {
      const query = String(args ?? "").trim();
      if (!query) {
        renderSearchWidget(ctx, cache);
        ctx.ui.notify("Usage: /websearch <query>", "info");
        return;
      }

      try {
        const provider = suggestProvider(query);
        const options = { maxResults: 5 };

        // Share the session cache with web_search: a /websearch run for a
        // query the model already searched (or vice versa) should hit the
        // cache instead of paying for the same query twice.
        const cacheKey = cache.key(query, [provider], options);
        const cached = cache.get(cacheKey);
        const results = cached ?? (await registry.getProvider(provider).search(query, options)).results;

        if (!cached) {
          cache.set(cacheKey, results);
          cache.evictExpired();
        }

        renderSearchWidget(ctx, cache);

        ctx.ui.notify(
          `Found ${results.length} results for "${query}"${cached ? " (cached)" : ""}`,
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown search error";
        ctx.ui.notify(`Web search failed: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("websearch-cache", {
    description: "Show how many searches are cached in the current session.",
    handler: async (_args, ctx) => {
      renderSearchWidget(ctx, cache);
      ctx.ui.notify(`Current web-search cache size: ${cache.size()} entries`, "info");
    },
  });

  // ── Tool registration ──────────────────────────────────────────────────
  pi.registerTool(createSearchTool(() => cache, () => config));
  pi.registerTool(
    createFetchTool(
      () => budget,
      () => counter,
      () => config,
      () => store,
    ),
  );
  pi.registerTool(createGetContentTool(() => store));
}
