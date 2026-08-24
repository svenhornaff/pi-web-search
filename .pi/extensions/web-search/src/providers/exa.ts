/**
 * Exa Search provider implementation.
 *
 * Exa is a neural search engine trained on link prediction — it understands
 * semantic relationships between documents rather than just keyword frequency.
 * Best for: research, AI topics, semantic discovery, finding recent papers.
 *
 * API: POST https://api.exa.ai/search
 * Docs: https://docs.exa.ai/reference/search
 *      https://exa.ai/docs/reference/search-api-guide-for-coding-agents
 *
 * Content strategy: request highlights (10x fewer tokens than text, vendor's
 * stated best practice for agent workflows) with text as a fallback field
 * when highlights come back empty. See search-architecture-review.md §Finding 1.
 *
 * Free tier: 1,000 searches/month (dashboard.exa.ai)
 * Pricing: ~$0.007 per search (neural auto mode)
 *
 * API key resolution order:
 *   1. macOS Keychain → service "exa-api-key"
 *   2. Environment variable → EXA_API_KEY
 *   3. Workspace .env file → EXA_API_KEY
 *
 * Store in Keychain:
 *   security add-generic-password -a "$USER" -s "exa-api-key" -w "YOUR_KEY" -U
 *
 * Zero-config note: Exa's hosted MCP server (https://mcp.exa.ai/mcp) works
 * without an API key, but that is an MCP protocol endpoint — not a REST API
 * callable via fetch(). This provider requires EXA_API_KEY. If no key is
 * configured, search() throws and the fallback chain in tool-search.ts
 * transparently moves to the next provider (Brave or Tavily).
 */

import { resolveApiKey } from "../keychain.js";
import { fetchWithRetry } from "../retry.js";
import type { SearchProvider, SearchOptions, SearchResponse } from "./base.js";

const EXA_SEARCH_URL = "https://api.exa.ai/search";

const EXA_KEY_CONFIG = {
  keychainService: "exa-api-key",
  envVar: "EXA_API_KEY",
  displayName: "Exa API key",
} as const;

/** Exa API response shape (only fields we use) */
interface ExaApiResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
    highlights?: string[];
    summary?: string;
    publishedDate?: string;
    author?: string;
  }>;
  requestId?: string;
}

export class ExaProvider implements SearchProvider {
  readonly name = "exa";
  readonly type = "contextual" as const;
  private apiKey?: string;

  /**
   * @param apiKey Inject a key directly (tests, or callers with their own
   *   resolution). Falls back to resolveApiKey() (Keychain/env/.env) on
   *   first use when omitted.
   */
  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    options?: SearchOptions,
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    // Lazy-load API key
    if (!this.apiKey) {
      this.apiKey = await resolveApiKey(EXA_KEY_CONFIG);
    }

    const requestBody: Record<string, unknown> = {
      query,
      numResults: Math.min(options?.maxResults ?? 5, 20),
      type: "auto",
      contents: {
        // highlights: vendor's stated best practice for agent workflows;
        // returns the most relevant excerpts at ~10x fewer tokens than text.
        // text kept alongside as fallback for results where highlights is empty.
        // Both fields can be requested in the same call (Exa docs confirmed).
        highlights: { numSentences: 5, highlightsPerUrl: 3 },
        text: { maxCharacters: 2000 },
      },
    };

    // Freshness filtering via date range (Exa uses publishedDate)
    if (options?.freshness) {
      const cutoff = freshnessToDate(options.freshness);
      if (cutoff) {
        requestBody["startPublishedDate"] = cutoff.toISOString();
      }
    }

    const response = await fetchWithRetry(
      EXA_SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          // Exa's primary documented auth pattern (Aug 2026).
          // x-api-key is retained as a comment for rollback; both appear in
          // third-party guides but Authorization: Bearer is the canonical form.
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      },
      { retries: 2, delayMs: 400 },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Exa Search API ${response.status}: ${body}`);
    }

    const data = (await response.json()) as ExaApiResponse;

    const results = (data.results ?? [])
      .filter(
        (r): r is { title: string; url: string; text?: string; highlights?: string[]; summary?: string } =>
          typeof r.title === "string" && typeof r.url === "string",
      )
      .map((r) => {
        // Prefer highlights for fullContent (fewer tokens, highest-relevance excerpts).
        // Fall back to text when highlights is absent or empty.
        const highlightText =
          r.highlights && r.highlights.length > 0
            ? r.highlights.join(" … ")
            : undefined;
        return {
          title: r.title,
          url: r.url,
          description: r.summary ?? highlightText?.slice(0, 300) ?? r.text?.slice(0, 300) ?? "",
          fullContent: highlightText ?? r.text,
        };
      });

    return {
      results,
      query,
      provider: this.name,
    };
  }
}

/**
 * Convert a freshness string to a cutoff Date for startPublishedDate.
 */
function freshnessToDate(freshness: "day" | "week" | "month" | "year"): Date | null {
  const now = new Date();
  switch (freshness) {
    case "day":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "year":
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}
