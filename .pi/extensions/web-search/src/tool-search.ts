/**
 * web_search tool definition and execute handler.
 */

import { Type } from "@sinclair/typebox";
import { registry, type ProviderName } from "./providers/registry.js";
import { suggestProvider } from "./provider-selector.js";
import { aggregate } from "./search-aggregator.js";
import type { SearchCache } from "./search-cache.js";
import { formatSearchResults } from "./format.js";
import type { WebSearchConfig } from "./config.js";

interface SearchParams {
  query: string;
  max_results?: number;
  provider?: string;
  freshness?: string;
  depth?: string;
  providers?: string[];
}

export function createSearchTool(
  getCache: SearchCache | (() => SearchCache),
  getConfig?: () => WebSearchConfig | null,
) {
  const resolveCache = (): SearchCache =>
    typeof getCache === "function" ? getCache() : getCache;
  const resolveConfig = (): WebSearchConfig | null => getConfig?.() ?? null;

  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Exa, Brave, or Tavily. Provider is chosen automatically based on query type. For comprehensive research use providers: ['brave','tavily'] to query both in parallel and merge results. Use when you need current information about libraries, frameworks, documentation, release notes, or any topic where your training data may be outdated.",
    promptSnippet:
      "Search the web for current docs, libraries, how-tos, and community content",
    promptGuidelines: [
      "Use web_search when the user asks about latest versions, recent changes, current best practices, or anything time-sensitive.",
      "Use web_search when you are unsure about a library API, configuration, or setup procedure.",
      "Prefer specific, targeted queries (3–6 words). Run multiple searches if the topic is broad.",
      "Provider is auto-selected when omitted. Set provider: 'exa' for neural semantic search (AI/research topics), 'brave' for fast contextual search, or 'tavily' for deep keyword search with full page content.",
      "For comprehensive research pass providers: ['brave','tavily'] to query both in parallel — costs 2 API calls but gives broader coverage with deduplication.",
      "For latest releases or docs, use freshness: 'month' or 'week' (Brave only).",
      "For breaking news, use freshness: 'day' (Brave only).",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search query — keep it short and specific (3–6 words). Example: 'FastAPI Pydantic v2 migration'",
      }),
      max_results: Type.Optional(
        Type.Number({
          description: "Number of results to return (default 5, max 20)",
          minimum: 1,
          maximum: 20,
        }),
      ),
      provider: Type.Optional(
        Type.Union([Type.Literal("exa"), Type.Literal("brave"), Type.Literal("tavily")], {
          description:
            "Search provider: 'exa' (neural semantic search, best for research/AI topics), 'brave' (fast contextual SERP), or 'tavily' (deep keyword search with full content)",
        }),
      ),
      freshness: Type.Optional(
        Type.Union(
          [
            Type.Literal("day"),
            Type.Literal("week"),
            Type.Literal("month"),
            Type.Literal("year"),
          ],
          {
            description:
              "Time filter: 'day', 'week', 'month', 'year' (Brave only)",
          },
        ),
      ),
      depth: Type.Optional(
        Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
          description:
            "Search depth: 'basic' (1 credit) or 'advanced' (2 credits, more sources) — Tavily only",
        }),
      ),
      providers: Type.Optional(
        Type.Array(
          Type.Union([Type.Literal("exa"), Type.Literal("brave"), Type.Literal("tavily")]),
          {
            description:
              "Query multiple providers in parallel and merge results. Example: ['brave','tavily'] or ['exa','brave']. Takes precedence over provider (singular).",
            minItems: 1,
            maxItems: 3,
          },
        ),
      ),
    }),

    async execute(_toolCallId: string, _params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) {
      const params = _params as SearchParams;
      const config = resolveConfig();
      const options = {
        maxResults: params.max_results ?? 5,
        freshness: params.freshness as
          | "day"
          | "week"
          | "month"
          | "year"
          | undefined,
        depth: params.depth as "basic" | "advanced" | undefined,
      };

      // providers[] wins over provider (singular) wins over auto-selection
      const requestedProviders = params.providers as
        | ProviderName[]
        | undefined;
      const singleProvider = params.provider as ProviderName | undefined;

      const cache = resolveCache();

      if (requestedProviders && requestedProviders.length > 1) {
        // ── Multi-provider: run in parallel, merge results ──────────────
        const cacheKey = cache.key(params.query, requestedProviders, options);
        const cached = cache.get(cacheKey);

        if (cached) {
          const formatted = formatSearchResults(cached, requestedProviders);
          return {
            content: [{ type: "text" as const, text: formatted }],
            details: {
              query: params.query,
              providers: requestedProviders,
              resultCount: cached.length,
              deduplicatedFrom: cached.length,
              overlap: [] as string[],
              results: cached,
              cached: true,
            },
          };
        }

        const responses = await registry.searchAll(
          requestedProviders,
          params.query,
          options,
          signal,
        );
        if (responses.length === 0) throw new Error("All providers failed (multi-provider)");

        const aggregated = aggregate(responses);
        cache.set(cacheKey, aggregated.results);
        cache.evictExpired();

        return {
          content: [
            {
              type: "text" as const,
              text: formatSearchResults(
                aggregated.results,
                aggregated.meta.providers,
              ),
            },
          ],
          details: {
            query: aggregated.query,
            providers: aggregated.meta.providers,
            resultCount: aggregated.results.length,
            deduplicatedFrom: aggregated.meta.totalBeforeDedup,
            overlap: aggregated.meta.overlap,
            results: aggregated.results,
            cached: false,
          },
        };
      }

      // ── Single provider (with fallback chain) ────────────────────────
      // Explicit provider param = no fallback (user made a deliberate choice).
      // Auto-selected = run fallback chain so a missing/failing primary
      // degrades to the next available provider automatically.
      const primaryProvider =
        singleProvider ?? requestedProviders?.[0] ?? suggestProvider(params.query);

      const cacheKey = cache.key(params.query, [primaryProvider], options);
      const cached = cache.get(cacheKey);

      if (cached) {
        return {
          content: [
            { type: "text" as const, text: formatSearchResults(cached, primaryProvider) },
          ],
          details: {
            query: params.query,
            providers: [primaryProvider],
            resultCount: cached.length,
            deduplicatedFrom: cached.length,
            overlap: [] as string[],
            results: cached,
            cached: true,
          },
        };
      }

      // Build fallback chain: primary first, then config order minus primary.
      // Explicit provider = single-entry chain (no silent fallback).
      const fallbackChain: ProviderName[] =
        singleProvider != null
          ? [singleProvider]
          : [
              primaryProvider,
              ...(config?.fallbackOrder ?? ["brave", "tavily"] as ProviderName[]).filter(
                (p: ProviderName) => p !== primaryProvider,
              ),
            ];

      const response = await registry.searchWithFallback(
        fallbackChain,
        params.query,
        options,
        signal,
      );
      cache.set(cacheKey, response.results);
      cache.evictExpired();

      return {
        content: [
          {
            type: "text" as const,
            text: formatSearchResults(response.results, response.provider),
          },
        ],
        details: {
          query: response.query,
          providers: [response.provider],
          resultCount: response.results.length,
          deduplicatedFrom: response.results.length,
          overlap: [] as string[],
          results: response.results,
          cached: false,
        },
      };
    },
  };
}
