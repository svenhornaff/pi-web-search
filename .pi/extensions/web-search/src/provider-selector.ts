/**
 * Automatic provider selection heuristics.
 *
 * Analyses the query string and suggests the most appropriate provider.
 * The LLM-specified `provider` parameter always takes precedence —
 * this only runs when the user/model omits it.
 *
 * Rules (first match wins):
 *   → tavily  for research-heavy patterns: comparisons, guides, deep dives
 *   → brave   for time-sensitive patterns: latest releases, breaking news
 *   → brave   default (fast, cheap, no Tavily key required)
 */

import type { ProviderName } from "./providers/registry.js";

const TAVILY_PATTERNS = [
  /\b(compare|vs\.?|versus|benchmark|difference between)\b/i,
  /\b(comprehensive|complete guide|deep dive|in[- ]depth|overview of)\b/i,
  /\b(best practices|how does .+ work|explain|understand)\b/i,
];

const BRAVE_PATTERNS = [
  /\b(latest|newest|just released|what('s| is) new|breaking|recent|changelog|release notes?)\b/i,
];

export function suggestProvider(query: string): ProviderName {
  if (TAVILY_PATTERNS.some((re) => re.test(query))) return "tavily";
  if (BRAVE_PATTERNS.some((re) => re.test(query))) return "brave";
  return "brave";
}
