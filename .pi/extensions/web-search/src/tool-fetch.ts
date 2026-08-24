/**
 * web_fetch tool definition and execute handler.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ModelBudget, ExtractedContent } from "./types.js";
import type { TokenCounter } from "./token-counter.js";
import { effectiveContentBudget } from "./token-budget.js";
import { processContent } from "./content-processor.js";
import { extractPDF } from "./pdf-extractor.js";
import { buildFetchResponse } from "./format.js";
import { cleanExpiredSpillover } from "./spillover.js";
import { safeFetch, readBoundedArrayBuffer, readBoundedText } from "./safe-fetch.js";
import { matchGitHubUrl, fetchGitHub } from "./github-handler.js";
import { checkDomainPolicy } from "./ssrf.js";
import type { WebSearchConfig } from "./config.js";
import type { ContentStore } from "./content-store.js";

/**
 * Store a handle in ContentStore when content was truncated.
 * Stores `extracted.fullMarkdown` (pre-truncation) rather than `mainContent`
 * (already-truncated) so get_fetch_content returns the real full text.
 */
function maybeStoreHandle(
  extracted: ExtractedContent,
  url: string,
  getStore: (() => ContentStore) | undefined,
): void {
  if (!extracted.metadata.truncated || !getStore) return;
  const store = getStore();
  // Use fullMarkdown (pre-truncation) when available; fall back to mainContent
  // for paths (e.g. PDF) that don't set fullMarkdown yet.
  const content = extracted.fullMarkdown ?? extracted.mainContent;
  const handle = store.store(url, content, extracted.metadata.title);
  extracted.metadata.spillover = extracted.metadata.spillover ?? {
    path: `[handle:${handle}]`,
    format: "markdown",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    totalSections: extracted.metadata.sections.length,
    excludedSections: extracted.metadata.sections.filter((s) => !s.included).map((s) => s.title),
  };
  (extracted.metadata as Record<string, unknown>)["handle"] = handle;
}

interface FetchResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

/**
 * Wrap a fetch result in answer mode: prepend a focused preamble so the
 * model knows these are the most relevant sections for a specific question.
 * Section ranking already surfaces the best content; answer mode just
 * reframes the output and adds a relevance header.
 */
function applyAnswerMode(result: FetchResult, prompt: string): FetchResult {
  const text = result.content[0]?.text ?? "";
  const answeredText =
    `> **Question**: ${prompt}\n>\n` +
    `> Sections most relevant to the question are shown below.\n\n` +
    text;
  return {
    content: [{ type: "text" as const, text: answeredText }],
    details: { ...result.details, answerMode: true, prompt },
  };
}

interface FetchParams {
  url: string;
  mode?: "extract" | "answer";
  prompt?: string;
}

export function createFetchTool(
  getBudget: () => ModelBudget,
  getCounter: () => TokenCounter,
  getConfig?: () => WebSearchConfig | null,
  getStore?: () => ContentStore,
) {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract readable text content from a web page URL. Use after web_search to read full documentation pages, blog posts, READMEs, or release notes. Returns clean markdown with structured sections. Use mode: 'answer' with a prompt to get a focused extraction relevant to a specific question.",
    promptSnippet:
      "Fetch and extract readable content from a URL (docs, blog posts, READMEs)",
    promptGuidelines: [
      "Use web_fetch to read the full content of a URL returned by web_search.",
      "Do not fetch URLs speculatively — only fetch when the content is needed to answer the user's question.",
      "If content is truncated, check the spillover path in details for full content.",
      "Use mode: 'answer' with a prompt to get sections most relevant to a specific question instead of the full page.",
    ],
    parameters: Type.Object({
      url: Type.String({
        description: "Full URL to fetch (must include https://)",
        pattern: "^https://",
      }),
      mode: Type.Optional(Type.Union(
        [Type.Literal("extract"), Type.Literal("answer")],
        { description: "'extract' (default) returns full ranked content. 'answer' focuses extraction on sections most relevant to prompt." },
      )),
      prompt: Type.Optional(Type.String({
        description: "Question or focus for answer mode. Only used when mode is 'answer'.",
      })),
    }),

    async execute(_toolCallId: string, _params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
      const params = _params as FetchParams;
      const cwd = ctx.cwd;
      const config = getConfig?.();
      const isAnswerMode = params.mode === "answer" && typeof params.prompt === "string" && params.prompt.trim().length > 0;

      // Domain policy check — before any network call.
      if (config?.domainPolicy) {
        const hostname = new URL(params.url).hostname;
        const blocked = checkDomainPolicy(hostname, config.domainPolicy);
        if (blocked) throw new Error(blocked);
      }

      // Opportunistic cache cleanup — fire-and-forget, never blocks the fetch
      cleanExpiredSpillover(cwd).catch(() => {});

      const staticBudget = getBudget();
      const counter = getCounter();

      // Dynamic budget: reduce maxContentTokens based on how much context
      // the session has already consumed (prevents stuffing 750K of web
      // content into a session that already has 900K of conversation).
      const usage = ctx.getContextUsage();
      const dynamicMax = effectiveContentBudget(staticBudget, usage?.tokens);
      const budget: ModelBudget = dynamicMax !== staticBudget.maxContentTokens
        ? { ...staticBudget, maxContentTokens: dynamicMax }
        : staticBudget;

      // safeFetch validates the URL (and every redirect hop) before it fires,
      // retries transient failures, and refuses to buffer an oversized body.
      const response = await safeFetch(params.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; pi-web-search/0.3; +https://pi.dev)",
          Accept:
            "text/html,application/xhtml+xml,text/plain,application/pdf",
        },
        signal,
      });
      if (!response.ok)
        throw new Error(`Fetch failed ${response.status}: ${params.url}`);

      const contentType = response.headers.get("content-type") ?? "";
      const isPdf =
        contentType.includes("application/pdf") ||
        response.url.toLowerCase().endsWith(".pdf");

      // ── PDF path ──────────────────────────────────────────────────────
      if (isPdf) {
        const buffer = await readBoundedArrayBuffer(response);
        const extracted = await extractPDF(buffer, response.url, budget, counter, cwd);
        maybeStoreHandle(extracted, response.url, getStore);
        const result = buildFetchResponse(response.url, extracted, budget) as FetchResult;
        return isAnswerMode ? applyAnswerMode(result, params.prompt ?? "") : result;
      }

      // ── HTML path ─────────────────────────────────────────────────────
      // ── GitHub path ────────────────────────────────────────────────
      // Detect GitHub URLs before generic HTML extraction: blob files go to
      // raw.githubusercontent.com; tree listings and repo roots use the API.
      // Falls back to HTML if the GitHub handler returns null.
      const ghMatch = matchGitHubUrl(params.url);
      if (ghMatch) {
        const ghResult = await fetchGitHub(params.url, ghMatch, signal);
        if (ghResult) {
          const ghExtracted = await processContent(
            ghResult.markdown,
            ghResult.url,
            budget,
            counter,
            cwd,
            isAnswerMode ? (params.prompt ?? undefined) : undefined,
          );
          ghExtracted.metadata.title = ghResult.title;
          maybeStoreHandle(ghExtracted, ghResult.url, getStore);
          const base = buildFetchResponse(ghResult.url, ghExtracted, budget) as FetchResult;
          const ghFinal = { ...base, details: { ...base.details, githubStrategy: ghResult.strategy } };
          return isAnswerMode ? applyAnswerMode(ghFinal, params.prompt ?? "") : ghFinal;
        }
        // GitHub handler failed — fall through to generic HTML
      }

      const html = await readBoundedText(response);
      const extracted = await processContent(
        html,
        response.url,
        budget,
        counter,
        cwd,
        isAnswerMode ? (params.prompt ?? undefined) : undefined,
      );
      maybeStoreHandle(extracted, response.url, getStore);
      const result = buildFetchResponse(response.url, extracted, budget) as FetchResult;
      return isAnswerMode ? applyAnswerMode(result, params.prompt ?? "") : result;
    },
  };
}
