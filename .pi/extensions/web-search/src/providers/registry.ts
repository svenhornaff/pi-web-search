/**
 * Provider registry for managing search providers.
 * 
 * Supports:
 * - Dynamic provider selection
 * - Fallback to default provider if requested provider unavailable
 * - Provider availability checking
 */

import type { SearchProvider, SearchOptions, SearchResponse } from "./base.js";
import { BraveProvider } from "./brave.js";
import { TavilyProvider } from "./tavily.js";
import { ExaProvider } from "./exa.js";

/** Available provider names */
export type ProviderName = "exa" | "brave" | "tavily";

/** Provider registry singleton */
export class ProviderRegistry {
  private providers = new Map<ProviderName, SearchProvider>();
  private defaultProvider: ProviderName = "exa";

  constructor() {
    // Exa registered first — it becomes the default when a key is present
    // and the fallback chain starts with it. If no key is configured,
    // search() throws and the fallback chain moves to brave/tavily.
    this.register("exa", new ExaProvider());
    this.register("brave", new BraveProvider());
    this.register("tavily", new TavilyProvider());
  }

  /**
   * Register a provider.
   */
  register(name: ProviderName, provider: SearchProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * Get a provider by name.
   * Falls back to default provider if requested provider is not available.
   */
  getProvider(name?: ProviderName): SearchProvider {
    const providerName = name ?? this.defaultProvider;
    const provider = this.providers.get(providerName);

    if (!provider) {
      // Fallback to default if requested provider not found
      const defaultProvider = this.providers.get(this.defaultProvider);
      if (!defaultProvider) {
        throw new Error(`No providers available`);
      }
      return defaultProvider;
    }

    return provider;
  }

  /**
   * Check if a provider is available.
   * This checks if the provider is registered, but doesn't validate API keys.
   */
  hasProvider(name: ProviderName): boolean {
    return this.providers.has(name);
  }

  /**
   * Get all registered provider names.
   */
  getProviderNames(): ProviderName[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Set the default provider.
   */
  setDefaultProvider(name: ProviderName): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider ${name} not registered`);
    }
    this.defaultProvider = name;
  }

  /**
   * Get the default provider name.
   */
  getDefaultProviderName(): ProviderName {
    return this.defaultProvider;
  }

  /**
   * Try providers in order, returning the first success.
   * Falls through to the next provider only when the current one throws
   * (missing key, 401, network error, etc.).
   *
   * This is the right path for single-provider calls — `getProvider()` only
   * falls back when the *name* is unregistered, not when search() fails.
   */
  async searchWithFallback(
    names: ProviderName[],
    query: string,
    options?: SearchOptions,
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    let lastError: unknown;
    for (const name of names) {
      try {
        return await this.getProvider(name).search(query, options, signal);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("All providers failed");
  }

  /**
   * Run multiple providers in parallel.
   * Returns only fulfilled responses — a single provider failure never
   * blocks the others.
   */
  async searchAll(
    names: ProviderName[],
    query: string,
    options?: SearchOptions,
    signal?: AbortSignal,
  ): Promise<SearchResponse[]> {
    const results = await Promise.allSettled(
      names.map((name) => this.getProvider(name).search(query, options, signal)),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<SearchResponse> => r.status === "fulfilled")
      .map((r) => r.value);
  }
}

// Export singleton instance
export const registry = new ProviderRegistry();
