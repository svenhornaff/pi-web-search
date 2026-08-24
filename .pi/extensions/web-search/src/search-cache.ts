/**
 * In-memory search result cache.
 *
 * TTL: 5 minutes — short enough that freshness is preserved, long enough
 * to absorb repeated identical queries within a single research session.
 *
 * Cache is per-instance: callers hold a SearchCache object created in the
 * extension factory closure, so it is cleared automatically on /reload.
 */

import type { SearchResult } from "./providers/base.js";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  results: SearchResult[];
  expiresAt: number;
}

export class SearchCache {
  private readonly store = new Map<string, CacheEntry>();

  /** Build a stable cache key from query + resolved providers + search options */
  key(query: string, providers: string[], options: Record<string, unknown>): string {
    // Sort providers for stability: ["tavily","brave"] === ["brave","tavily"]
    const sorted = [...providers].sort();
    return JSON.stringify({ q: query, p: sorted, o: options });
  }

  get(key: string): SearchResult[] | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.results;
  }

  set(key: string, results: SearchResult[]): void {
    this.store.set(key, { results, expiresAt: Date.now() + TTL_MS });
  }

  /** Clear all cached search results for a new session or manual refresh. */
  clear(): void {
    this.store.clear();
  }

  /** Number of current entries in the cache. */
  size(): number {
    return this.store.size;
  }

  /** Evict all expired entries. Called opportunistically — never blocks. */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}
