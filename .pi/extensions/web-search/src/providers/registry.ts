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

/** Available provider names */
export type ProviderName = "brave" | "tavily";

/** Provider registry singleton */
class ProviderRegistry {
  private providers = new Map<ProviderName, SearchProvider>();
  private defaultProvider: ProviderName = "brave";

  constructor() {
    // Register built-in providers
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
