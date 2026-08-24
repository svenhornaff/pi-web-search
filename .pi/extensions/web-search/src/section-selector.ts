/**
 * Shared section selection — greedy budget-fill ranked by importance.
 *
 * Used by both content-processor.ts (HTML) and pdf-extractor.ts (PDF).
 * Sections are **sorted by rank (descending)** before the greedy fill,
 * so the most important sections are included first regardless of their
 * position in the source document.  After selection, the output markdown
 * preserves original document order (sorted by startLine).
 */

import type { Section } from "./types.js";
import type { TokenCounter } from "./token-counter.js";

export interface SelectionResult {
  /** Combined markdown of selected sections (in original document order). */
  markdown: string;
  /** All sections with `included` flag set. */
  sections: Section[];
  /** Estimated total tokens across all sections. */
  totalTokens: number;
  /** Exact token count of the returned markdown. */
  returnedTokens: number;
  /** True when at least one section was excluded. */
  truncated: boolean;
}

/**
 * Select sections within a token budget using a greedy algorithm.
 *
 * @param sections   – ranked sections to choose from
 * @param maxTokens  – maximum token budget for the output
 * @param counter    – token counter for the final exact count
 * @param separator  – string placed between selected sections (default: "\n\n")
 */
export async function selectSections(
  sections: Section[],
  maxTokens: number,
  counter: TokenCounter,
  separator = "\n\n",
): Promise<SelectionResult> {
  // Sort by rank (highest first) — ensures the most important sections
  // are picked before budget runs out.
  const sorted = [...sections].sort((a, b) => b.rank - a.rank);

  const selected: Section[] = [];
  let currentTokens = 0;
  const totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);

  // Greedy selection: add highest-ranked sections until budget exceeded
  for (const section of sorted) {
    if (currentTokens + section.tokens <= maxTokens) {
      selected.push({ ...section, included: true });
      currentTokens += section.tokens;
    } else {
      selected.push({ ...section, included: false });
    }
  }

  // Build markdown from selected sections in original document order
  const includedSections = selected
    .filter((s) => s.included)
    .sort((a, b) => a.startLine - b.startLine);

  const markdown = includedSections.map((s) => s.content).join(separator);

  // Get exact token count for final content
  const returnedTokens = await counter.count(markdown);

  // Merge selected flags back into original order — O(n) via Map
  const selectedById = new Map(selected.map((s) => [s.id, s]));
  const allSections = sections.map((s) => selectedById.get(s.id) ?? s);

  return {
    markdown,
    sections: allSections,
    totalTokens,
    returnedTokens,
    truncated: allSections.some((s) => !s.included),
  };
}
