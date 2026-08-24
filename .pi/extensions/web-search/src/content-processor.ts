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
import { safeFetch, readBoundedText } from "./safe-fetch.js";
import { extractRscContent } from "./rsc-parser.js";

/**
 * Minimum token count to consider extraction "successful".
 * Below this threshold we try the Jina reader fallback.
 */
const MIN_CONTENT_TOKENS = 50;

/**
 * Jina Reader fallback for JS-rendered / cookie-walled pages.
 * https://r.jina.ai/<url> returns clean markdown, no API key needed.
 * Returns the reader markdown on success, null if unavailable.
 */
async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await safeFetch(jinaUrl, {
      headers: {
        Accept: "text/plain, text/markdown, */*",
        "User-Agent": "Mozilla/5.0 (compatible; pi-web-search/0.8; +https://pi.dev)",
        // Ask Jina for markdown output
        "X-Return-Format": "markdown",
      },
    });
    if (!response.ok) return null;
    const text = await readBoundedText(response);
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Process HTML into structured content within token budget */
export async function processContent(
  html: string,
  url: string,
  budget: ModelBudget,
  counter: TokenCounter,
  cwd?: string,
): Promise<ExtractedContent> {
  // Step 1: Extract clean markdown
  const extracted0 = await extractMarkdown(html, url);
  const { title } = extracted0;
  let { markdown, excerpt } = extracted0;

  // Step 1b: RSC / Next.js flight-data extraction
  // Try this before Jina: if the page ships RSC flight data, we can extract
  // content directly from the HTML without a second network round-trip.
  // Only triggered when the standard extraction yields near-empty content.
  const quickTokenEstimate = Math.ceil(markdown.length / 4);
  if (quickTokenEstimate < MIN_CONTENT_TOKENS) {
    const rscText = extractRscContent(html);
    if (rscText && Math.ceil(rscText.length / 4) > quickTokenEstimate) {
      markdown = rscText;
      if (!excerpt) excerpt = rscText.slice(0, 200).replace(/\n+/g, " ").trim();
    }
  }

  // Step 1c: Jina Reader fallback for JS-rendered / cookie-walled pages.
  // Only triggered when both standard extraction and RSC parsing yield sparse content.
  const tokenEstimateAfterRsc = Math.ceil(markdown.length / 4);
  if (tokenEstimateAfterRsc < MIN_CONTENT_TOKENS && url.startsWith("https://")) {
    const jinaMarkdown = await fetchViaJina(url);
    if (jinaMarkdown && Math.ceil(jinaMarkdown.length / 4) > tokenEstimateAfterRsc) {
      markdown = jinaMarkdown;
      if (!excerpt) excerpt = jinaMarkdown.slice(0, 200).replace(/\n+/g, " ").trim();
    }
  }

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
