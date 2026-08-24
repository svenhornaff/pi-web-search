/**
 * Automatic provider selection heuristics.
 *
 * Analyses the query string and suggests the most appropriate provider.
 * The LLM-specified `provider` parameter always takes precedence —
 * this only runs when the user/model omits it.
 *
 * Rules (first match wins):
 *   → exa    for semantic/research patterns: AI topics, papers, concepts
 *   → tavily for deep-research patterns: comparisons, guides, full-content
 *   → brave  for time-sensitive patterns: latest releases, breaking news
 *   → brave  default (fast, independent index, no Exa key required)
 *
 * Note: the actual provider used at runtime may differ because the fallback
 * chain in tool-search.ts will transparently try the next provider if the
 * suggested one fails (e.g. missing API key). The heuristic sets priority;
 * the chain ensures a result is always returned when any provider is available.
 */

import type { ProviderName } from "./providers/registry.js";

/** Exa excels at semantic/neural search — AI research, concepts, papers */
const EXA_PATTERNS = [
  /\b(research paper|arxiv|preprint|study|academic|survey|literature)\b/i,
  /\b(how (does|do)|why (does|do|is|are)|explain|understand|concept)\b/i,
  /\b(machine learning|deep learning|neural network|large language model|llm|transformer)\b/i,
];

/** Tavily excels at deep keyword research with full-content inline */
const TAVILY_PATTERNS = [
  /\b(compare|vs\.?|versus|benchmark|difference between)\b/i,
  /\b(comprehensive|complete guide|deep dive|in[- ]depth|overview of)\b/i,
  /\b(best practices|tutorial|step.by.step|getting started)\b/i,
];

/** Brave excels at time-sensitive SERP with freshness filters */
const BRAVE_PATTERNS = [
  /\b(latest|newest|just released|what('s| is) new|breaking|recent|changelog|release notes?)\b/i,
];

export function suggestProvider(query: string): ProviderName {
  if (EXA_PATTERNS.some((re) => re.test(query))) return "exa";
  if (TAVILY_PATTERNS.some((re) => re.test(query))) return "tavily";
  if (BRAVE_PATTERNS.some((re) => re.test(query))) return "brave";
  return "brave";
}
