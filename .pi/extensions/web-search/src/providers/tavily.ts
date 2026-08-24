/**
 * Tavily Search provider implementation.
 *
 * Design intent:
 *   Tavily is the keyword/deep-research complement to Brave's contextual SERP.
 *   Its key advantage is that search results already contain full page content
 *   (raw_content field via include_raw_content: true), so the LLM can read the
 *   full text of a page from web_search alone — no separate web_fetch call needed.
 *
 *   Tavily does NOT implement fetch() — web_fetch always uses a plain HTTP GET
 *   regardless of which provider was used for the preceding search. Routing
 *   web_fetch through the Tavily search API would waste a credit per call and
 *   return unreliable results (site: operator is undocumented in Tavily).
 *
 * Features:
 * - AI-native keyword search optimised for agents
 * - Deep research mode (basic/advanced)
 * - Full page content (raw_content) embedded in every search result
 * - AI-generated answer summary prepended to first result
 * - Free tier: 1000 credits/month
 *
 * Pricing:
 * - Basic search: 1 credit (~$0.008)
 * - Advanced search: 2 credits (~$0.016)
 *
 * API key resolution order:
 *   1. macOS Keychain → service "tavily-api-key"
 *   2. Environment variable → TAVILY_API_KEY
 *   3. Workspace .env file → TAVILY_API_KEY
 *
 * Store in Keychain:
 *   security add-generic-password -a "$USER" -s "tavily-api-key" -w "YOUR_KEY" -U
 */

import { resolveApiKey } from "../keychain.js";
import { fetchWithRetry } from "../retry.js";
import type {
  SearchProvider,
  SearchOptions,
  SearchResponse,
} from "./base.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

const TAVILY_KEY_CONFIG = {
  keychainService: "tavily-api-key",
  envVar: "TAVILY_API_KEY",
  displayName: "Tavily API key",
} as const;

export class TavilyProvider implements SearchProvider {
  readonly name = "tavily";
  readonly type = "keyword" as const;
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
      this.apiKey = await resolveApiKey(TAVILY_KEY_CONFIG);
    }

    // Build request body — api_key moved to Authorization header (Bearer scheme)
    // per current Tavily integration examples. Body-embedded credentials are more
    // likely to surface in proxy logs. See search-architecture-review.md §Finding 3.
    const requestBody = {
      query,
      search_depth: options?.depth ?? "basic",
      max_results: Math.min(options?.maxResults ?? 5, 20),
      include_answer: true, // Include AI-generated answer summary
      include_raw_content: true, // Include full page content
      include_images: false, // We don't need images for coding tasks
    };

    // Execute search
    const response = await fetchWithRetry(
      TAVILY_SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      },
      { retries: 2, delayMs: 400 },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Tavily Search API ${response.status}: ${body}`);
    }

    // Parse response
    const data = (await response.json()) as {
      answer?: string;
      query?: string;
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        raw_content?: string;
        score?: number;
      }>;
    };

    // Map results to our format
    const results = (data.results ?? [])
      .filter(
        (r): r is {
          title: string;
          url: string;
          content: string;
          raw_content?: string;
        } =>
          typeof r.title === "string" &&
          typeof r.url === "string" &&
          typeof r.content === "string",
      )
      .map((r) => ({
        title: r.title,
        url: r.url,
        description: r.content,
        fullContent: r.raw_content, // Tavily includes full page content!
      }));

    // If Tavily provided an AI answer, prepend it to the first result
    if (data.answer && results.length > 0 && results[0]) {
      const firstResult = results[0];
      firstResult.description = `**AI Summary**: ${data.answer}\n\n${firstResult.description}`;
    }

    return {
      results,
      query: data.query ?? query,
      provider: this.name,
    };
  }

  // fetch() is intentionally not implemented.
  // web_fetch always uses a plain HTTP GET — routing it through the Tavily
  // search API would cost 1 credit per call and is unreliable.
  // Tavily's full-content advantage is delivered via raw_content in search().
}
