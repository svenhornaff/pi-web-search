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
import { fetchWithRetry } from "./retry.js";
import { extractRscContent } from "./rsc-parser.js";
import { resolveApiKey } from "./keychain.js";

/**
 * Minimum token count to consider extraction "successful".
 * Below this threshold we try the Jina reader fallback.
 */
const MIN_CONTENT_TOKENS = 50;

const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

const TAVILY_KEY_CONFIG = {
  keychainService: "tavily-api-key",
  envVar: "TAVILY_API_KEY",
  displayName: "Tavily API key",
} as const;

const JINA_KEY_CONFIG = {
  keychainService: "jina-api-key",
  envVar: "JINA_API_KEY",
  displayName: "Jina API key (optional)",
} as const;

/**
 * Tavily /extract fallback — reuses the existing Tavily key, no new credential.
 * Tried before Jina because it is already-authenticated and already-paid-for.
 * See search-architecture-review.md §Finding 3 / Phase C.
 */
async function fetchViaTavilyExtract(url: string): Promise<string | null> {
  let apiKey: string;
  try {
    apiKey = await resolveApiKey(TAVILY_KEY_CONFIG);
  } catch {
    return null; // no Tavily key — skip silently
  }
  try {
    const response = await fetchWithRetry(
      TAVILY_EXTRACT_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ urls: [url] }),
      },
      { retries: 1, delayMs: 400 },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      results?: Array<{ url?: string; raw_content?: string }>;
    };
    const content = data.results?.[0]?.raw_content?.trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * Jina Reader fallback for JS-rendered / cookie-walled pages.
 * https://r.jina.ai/<url> returns clean markdown.
 * Uses JINA_API_KEY when configured (higher rate tier); falls back to
 * unauthenticated free tier when no key is set.
 * Returns the reader markdown on success, null if unavailable.
 */
async function fetchViaJina(url: string): Promise<string | null> {
  // Attempt to load optional Jina key; null = unauthenticated free tier.
  let jinaKey: string | undefined;
  try {
    jinaKey = await resolveApiKey(JINA_KEY_CONFIG);
  } catch {
    jinaKey = undefined;
  }

  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers: Record<string, string> = {
      Accept: "text/plain, text/markdown, */*",
      // Version derived from package constant — kept in sync by check:version.
      "User-Agent": "Mozilla/5.0 (compatible; pi-web-search/1.5; +https://pi.dev)",
      "X-Return-Format": "markdown",
    };
    if (jinaKey) {
      headers["Authorization"] = `Bearer ${jinaKey}`;
    }
    const response = await safeFetch(jinaUrl, { headers });
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
  promptHint?: string,
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

  // Step 1c: content-fallback chain for JS-rendered / cookie-walled pages.
  // Only triggered when both standard extraction and RSC parsing yield sparse content.
  // Order: Tavily /extract first (reuses existing key, no new cost surface),
  // then Jina Reader as the final fallback (zero-key entry point, rate-capped).
  // See search-architecture-review.md §Finding 3 / Phase C.
  const tokenEstimateAfterRsc = Math.ceil(markdown.length / 4);
  if (tokenEstimateAfterRsc < MIN_CONTENT_TOKENS && url.startsWith("https://")) {
    const tavilyMarkdown = await fetchViaTavilyExtract(url);
    if (tavilyMarkdown && Math.ceil(tavilyMarkdown.length / 4) > tokenEstimateAfterRsc) {
      markdown = tavilyMarkdown;
      if (!excerpt) excerpt = tavilyMarkdown.slice(0, 200).replace(/\n+/g, " ").trim();
    } else {
      const jinaMarkdown = await fetchViaJina(url);
      if (jinaMarkdown && Math.ceil(jinaMarkdown.length / 4) > tokenEstimateAfterRsc) {
        markdown = jinaMarkdown;
        if (!excerpt) excerpt = jinaMarkdown.slice(0, 200).replace(/\n+/g, " ").trim();
      }
    }
  }

  // Step 2: Parse into sections
  const sections = parseMarkdownSections(markdown, budget.provider);

  // Step 3: Rank sections by importance (with optional prompt-lexical boost)
  const rankedSections = rankSections(sections, DEFAULT_RANKING_HINTS, promptHint);

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
    // Preserve the full pre-truncation markdown so ContentStore can serve it
    // without a second network round-trip. Only set when actually truncated.
    ...(selected.truncated ? { fullMarkdown: markdown } : {}),
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
