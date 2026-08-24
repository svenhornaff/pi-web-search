/**
 * Brave Search provider implementation.
 * 
 * Features:
 * - LLM Context endpoint (`/res/v1/llm/context`) — machine-shaped output,
 *   benchmarked by Brave as "the most powerful Search API for AI".
 *   Replaced `/res/v1/web/search` per search-architecture-review.md §Finding 2.
 * - Freshness filters (day/week/month/year)
 * - Country-specific results
 * - Free tier: $5/month credits (~1000 queries)
 *
 * API key resolution order:
 *   1. macOS Keychain → service "brave-api-key"
 *   2. Environment variable → BRAVE_API_KEY
 *   3. Workspace .env file → BRAVE_API_KEY
 * 
 * Store in Keychain:
 *   security add-generic-password -a "$USER" -s "brave-api-key" -w "YOUR_KEY" -U
 */

import { resolveApiKey } from "../keychain.js";
import { fetchWithRetry } from "../retry.js";
import { safeFetch, readBoundedText } from "../safe-fetch.js";
import type {
  SearchProvider,
  SearchOptions,
  SearchResponse,
} from "./base.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/llm/context";

const BRAVE_KEY_CONFIG = {
  keychainService: "brave-api-key",
  envVar: "BRAVE_API_KEY",
  displayName: "Brave Search API key",
} as const;

export class BraveProvider implements SearchProvider {
  readonly name = "brave";
  readonly type = "contextual" as const;
  private apiKey?: string;

  /**
   * @param apiKey Inject a key directly (tests, or callers with their own
   *   resolution). Falls back to `resolveApiKey()` (Keychain/env/.env) on
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
    // Lazy load API key
    if (!this.apiKey) {
      this.apiKey = await resolveApiKey(BRAVE_KEY_CONFIG);
    }
    if (!this.apiKey) {
      throw new Error("Brave Search API key is not configured");
    }

    // Build query parameters
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(options?.maxResults ?? 5, 20)),
    });

    // Add freshness filter if specified
    if (options?.freshness) {
      params.set("freshness", options.freshness);
    }

    // Add country filter if specified
    if (options?.country) {
      params.set("country", options.country);
    }

    // Add safesearch filter
    if (options?.safesearch !== undefined) {
      params.set("safesearch", options.safesearch ? "strict" : "off");
    }

    // Execute search
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error("Brave Search API key is not configured");
    }

    const response = await fetchWithRetry(
      `${BRAVE_SEARCH_URL}?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal,
      },
      { retries: 2, delayMs: 400 },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Brave Search API ${response.status}: ${body}`);
    }

    // LLM Context endpoint returns a flat `results` array shaped for machine
    // consumption (title, url, description, snippet).
    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        snippet?: string;
      }>;
      // Legacy web.results shape retained as fallback in case the endpoint
      // returns the SERP format on older subscription tiers.
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
        }>;
      };
    };

    const rawResults = data.results ?? data.web?.results ?? [];
    const results = rawResults
      .filter(
        (r): r is { title: string; url: string; description: string } =>
          typeof r.title === "string" &&
          typeof r.url === "string" &&
          typeof r.description === "string",
      )
      .map((r) => ({
        title: r.title,
        url: r.url,
        description: (r as { snippet?: string }).snippet ?? r.description,
      }));

    return {
      results,
      query,
      provider: this.name,
    };
  }

  /**
   * Brave doesn't provide content fetch in search results,
   * so we provide a basic fetch implementation.
   */
  async fetch(url: string, signal?: AbortSignal) {
    const response = await safeFetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; pi-web-search/0.3; +https://pi.dev)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      signal,
      retries: 2,
      delayMs: 400,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status}: ${url}`);
    }

    const html = await readBoundedText(response);

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.trim().replace(/\s+/g, " ") ?? "";

    return {
      url,
      title,
      content: html,
    };
  }
}
