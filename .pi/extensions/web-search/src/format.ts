/**
 * Response formatting for web_search and web_fetch tool outputs.
 */

import type { ExtractedContent, ModelBudget } from "./types.js";
import type { SearchResult } from "./providers/base.js";

/**
 * Total inline fullContent budget across all results in one web_search response.
 * Default: 25% of a 128K-token model's content budget as a conservative cap.
 * Prevents five Tavily/Exa results at 30K chars each (~150K chars) from
 * overwhelming the context on a single search call.
 */
export const DEFAULT_TOTAL_FULL_CONTENT_CHARS = 150_000;

/** Per-result fullContent cap default: ~8k tokens ≈ 30k chars */
const DEFAULT_MAX_FULL_CONTENT_CHARS = 30_000;

function formatResult(r: SearchResult, i: number, maxFullContentChars = DEFAULT_MAX_FULL_CONTENT_CHARS): string {
  let entry = `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.description}`;
  if (r.fullContent) {
    const body =
      r.fullContent.length > maxFullContentChars
        ? r.fullContent.slice(0, maxFullContentChars) +
          "\n\n[...truncated — use web_fetch for full content]"
        : r.fullContent;
    entry += `\n\n    **Full content**:\n${body}`;
  }
  return entry;
}

export function formatSearchResults(
  results: SearchResult[],
  providers: string | string[],
  maxInlineContentChars = DEFAULT_MAX_FULL_CONTENT_CHARS,
  totalFullContentBudgetChars = DEFAULT_TOTAL_FULL_CONTENT_CHARS,
): string {
  if (results.length === 0) return "No results found.";
  const providerLabel = Array.isArray(providers)
    ? providers.join(", ")
    : providers;

  // Apply a total budget across all results' fullContent so a batch of
  // content-rich results can't silently exceed the model's context window.
  let remainingBudget = totalFullContentBudgetChars;
  const formatted = results.map((r, i) => {
    if (!r.fullContent || remainingBudget <= 0) {
      // No fullContent budget left — format without inline content.
      return formatResult({ ...r, fullContent: undefined }, i, maxInlineContentChars);
    }
    const allowed = Math.min(r.fullContent.length, remainingBudget, maxInlineContentChars);
    const trimmed = r.fullContent.length > allowed
      ? r.fullContent.slice(0, allowed) + "\n\n[...truncated — use web_fetch for full content]"
      : r.fullContent;
    remainingBudget -= allowed;
    return formatResult({ ...r, fullContent: trimmed }, i, allowed + 100 /* already trimmed */);
  });

  return (
    formatted.join("\n\n") +
    `\n\n---\n**Search provider${Array.isArray(providers) && providers.length > 1 ? "s" : ""}**: ${providerLabel}`
  );
}

/** Build a unified tool response for web_fetch (HTML + PDF share the same shape). */
export function buildFetchResponse(
  url: string,
  extracted: ExtractedContent,
  budget: ModelBudget,
) {
  let text = "";
  if (extracted.metadata.title) text += `# ${extracted.metadata.title}\n\n`;
  text += extracted.mainContent;
  text += "\n\n---\n\n";
  text += `**Content Summary**:\n`;
  text += `- Returned: ${extracted.metadata.returnedTokens} tokens (${extracted.metadata.sections.filter((s) => s.included).length}/${extracted.metadata.sections.length} sections)\n`;
  text += `- Total: ${extracted.metadata.totalTokens} tokens\n`;
  if (extracted.metadata.truncated && extracted.metadata.spillover) {
    text += `\n**Full content available**: ${extracted.metadata.spillover.path}\n`;
    if (extracted.metadata.spillover.excludedSections.length > 0) {
      text += `Excluded sections: ${extracted.metadata.spillover.excludedSections.slice(0, 5).join(", ")}${
        extracted.metadata.spillover.excludedSections.length > 5 ? ", ..." : ""
      }\n`;
    }
  }
  return {
    content: [{ type: "text" as const, text }],
    details: {
      url,
      title: extracted.metadata.title,
      truncated: extracted.metadata.truncated,
      tokenBudget: budget.maxContentTokens,
      tokenUsage: extracted.metadata.returnedTokens,
      sections: extracted.metadata.sections,
      spillover: extracted.metadata.spillover,
      provider: budget.provider,
      model: budget.model,
    },
  };
}
