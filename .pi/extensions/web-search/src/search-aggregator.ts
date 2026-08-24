/**
 * Multi-provider result aggregation.
 *
 * Merges SearchResponse arrays from parallel provider queries:
 *   - Deduplicates by normalised URL (strips www., protocol, trailing slash)
 *   - On collision: keeps the longer description, prefers Tavily fullContent
 *   - Ranks results found by multiple providers first, preserving original order otherwise
 */

import type { SearchResult, SearchResponse } from "./providers/base.js";

export interface AggregatedResult extends SearchResult {
  /** Which providers returned this URL */
  foundBy: string[];
}

export interface AggregationMeta {
  providers: string[];
  totalBeforeDedup: number;
  overlap: string[]; // normalised URLs found by more than one provider
}

export interface AggregatedResponse {
  results: AggregatedResult[];
  query: string;
  meta: AggregationMeta;
}

/** Strip protocol, www., and trailing slash for deduplication */
function normaliseUrl(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function aggregate(responses: SearchResponse[]): AggregatedResponse {
  const query = responses[0]?.query ?? "";
  const providers = responses.map((r) => r.provider);
  const totalBeforeDedup = responses.reduce((n, r) => n + r.results.length, 0);

  // Build map: normalised URL → merged result
  const seen = new Map<string, AggregatedResult>();

  for (const response of responses) {
    for (const result of response.results) {
      const key = normaliseUrl(result.url);
      const existing = seen.get(key);

      if (existing) {
        // Merge: prefer longer description, prefer any fullContent
        if (result.description.length > existing.description.length) {
          existing.description = result.description;
        }
        if (result.fullContent && !existing.fullContent) {
          existing.fullContent = result.fullContent;
        }
        existing.foundBy.push(response.provider);
      } else {
        seen.set(key, { ...result, foundBy: [response.provider] });
      }
    }
  }

  const overlap = Array.from(seen.values())
    .filter((r) => r.foundBy.length > 1)
    .map((r) => normaliseUrl(r.url));

  // Results found by multiple providers first, then preserve insertion order
  const results = Array.from(seen.values()).sort(
    (a, b) => b.foundBy.length - a.foundBy.length,
  );

  return { results, query, meta: { providers, totalBeforeDedup, overlap } };
}
