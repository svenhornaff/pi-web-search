/**
 * Main content processing pipeline.
 * Orchestrates extraction, parsing, ranking, and token budgeting.
 */

import type { ModelBudget, ExtractedContent } from "./types.js";
import type { TokenCounter } from "./token-counter.js";
import { extractMarkdown } from "./content-extractor.js";
import {
  parseMarkdownSections,
  rankSections,
  DEFAULT_RANKING_HINTS,
} from "./section-parser.js";
import { selectSections } from "./section-selector.js";
import { writeSpillover } from "./spillover.js";

/** Process HTML into structured content within token budget */
export async function processContent(
  html: string,
  url: string,
  budget: ModelBudget,
  counter: TokenCounter,
  cwd?: string,
): Promise<ExtractedContent> {
  // Step 1: Extract clean markdown
  const { title, markdown, excerpt } = await extractMarkdown(html, url);

  // Step 2: Parse into sections
  const sections = parseMarkdownSections(markdown, budget.provider);

  // Step 3: Rank sections by importance
  const rankedSections = rankSections(sections, DEFAULT_RANKING_HINTS);

  // Step 4: Select sections within token budget (shared implementation)
  const selected = await selectSections(
    rankedSections,
    budget.maxContentTokens,
    counter,
  );

  // Step 5: Write spillover if truncated
  let spillover;
  if (selected.truncated) {
    spillover = await writeSpillover(markdown, selected.sections, url, cwd);
  }

  return {
    summary: excerpt,
    mainContent: selected.markdown,
    metadata: {
      title,
      url,
      totalTokens: selected.totalTokens,
      returnedTokens: selected.returnedTokens,
      truncated: selected.truncated,
      sections: selected.sections.map((s) => ({
        title: s.title,
        level: s.level,
        startLine: s.startLine,
        tokens: s.tokens,
        included: s.included,
        rank: s.rank,
      })),
      spillover,
    },
  };
}
