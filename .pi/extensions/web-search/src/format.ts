/**
 * Response formatting for web_search and web_fetch tool outputs.
 */

import type { ExtractedContent, ModelBudget } from "./types.js";
import type { SearchResult } from "./providers/base.js";

/** Per-result fullContent cap: ~8k tokens ≈ 30k chars */
const MAX_FULL_CONTENT_CHARS = 30_000;

function formatResult(r: SearchResult, i: number): string {
  let entry = `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.description}`;
  if (r.fullContent) {
    const body =
      r.fullContent.length > MAX_FULL_CONTENT_CHARS
        ? r.fullContent.slice(0, MAX_FULL_CONTENT_CHARS) +
          "\n\n[...truncated — use web_fetch for full content]"
        : r.fullContent;
    entry += `\n\n    **Full content**:\n${body}`;
  }
  return entry;
}

export function formatSearchResults(
  results: SearchResult[],
  providers: string | string[],
): string {
  if (results.length === 0) return "No results found.";
  const providerLabel = Array.isArray(providers)
    ? providers.join(", ")
    : providers;
  return (
    results.map(formatResult).join("\n\n") +
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
