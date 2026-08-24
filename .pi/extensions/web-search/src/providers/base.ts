/**
 * Base provider interface for search providers.
 * 
 * Defines the contract that all search providers must implement.
 */

/** Search provider types */
export type ProviderType = 'contextual' | 'keyword';

/** Search options common across providers */
export interface SearchOptions {
  maxResults?: number;
  freshness?: 'day' | 'week' | 'month' | 'year';
  country?: string;
  safesearch?: boolean;
  depth?: 'basic' | 'advanced'; // Tavily-specific
}

/** Search result from any provider */
export interface SearchResult {
  title: string;
  url: string;
  description: string;
  fullContent?: string; // Some providers (Tavily) return full content
}

/** Search response */
export interface SearchResponse {
  results: SearchResult[];
  query: string;
  provider: string;
}

/** Base search provider interface */
export interface SearchProvider {
  /** Provider name (e.g., 'brave', 'tavily') */
  readonly name: string;
  
  /** Provider type (contextual or keyword-based) */
  readonly type: ProviderType;
  
  /** 
   * Search for content.
   * 
   * @param query - Search query
   * @param options - Search options
   * @param signal - Abort signal for cancellation
   * @returns Search results
   */
  search(
    query: string,
    options?: SearchOptions,
    signal?: AbortSignal,
  ): Promise<SearchResponse>;
  
  /**
   * Optional: Fetch full content from a URL via a plain HTTP GET.
   * Implement only when the provider has a meaningful fetch transport
   * (e.g. Brave performs a direct HTTP fetch).
   *
   * Providers whose content advantage is delivered through search results
   * (e.g. Tavily raw_content) should NOT implement this — routing web_fetch
   * through a search API wastes credits and returns unreliable results.
   *
   * @param url - URL to fetch
   * @param signal - Abort signal
   */
  fetch?(url: string, signal?: AbortSignal): Promise<{
    url: string;
    title: string;
    content: string;
  }>;
}
