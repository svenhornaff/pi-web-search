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
import { RateLimiter, DEFAULT_RATE_LIMITS } from "../rate-limiter.js";

/** Available provider names */
export type ProviderName = "exa" | "brave" | "tavily";

/** Provider registry singleton */
export class ProviderRegistry {
  private providers = new Map<ProviderName, SearchProvider>();
  private limiters = new Map<ProviderName, RateLimiter>();
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
   * Register a provider (and create its rate limiter if not already present).
   */
  register(name: ProviderName, provider: SearchProvider): void {
    this.providers.set(name, provider);
    if (!this.limiters.has(name)) {
      const rps = DEFAULT_RATE_LIMITS[name] ?? 5;
      this.limiters.set(name, new RateLimiter({ requestsPerSecond: rps }));
    }
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
   * Override the rate limit for a provider (useful in tests).
   */
  setRateLimit(name: ProviderName, requestsPerSecond: number): void {
    this.limiters.set(name, new RateLimiter({ requestsPerSecond }));
  }

  /**
   * Try providers in order, returning the first success.
   * Rate-limited: waits for the provider's token-bucket slot before firing.
   * Falls through to the next provider only when the current one throws
   * (missing key, 401, network error, etc.).
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
        await this.limiters.get(name)?.acquire(signal);
        return await this.getProvider(name).search(query, options, signal);
      } catch (error) {
        // If the signal was aborted, stop the fallback chain immediately.
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error("All providers failed");
  }

  /**
   * Run multiple providers in parallel.
   * Each provider is rate-limited independently.
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
      names.map(async (name) => {
        await this.limiters.get(name)?.acquire(signal);
        return this.getProvider(name).search(query, options, signal);
      }),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<SearchResponse> => r.status === "fulfilled")
      .map((r) => r.value);
  }
}

// Export singleton instance
export const registry = new ProviderRegistry();
