/**
 * web_fetch tool definition and execute handler.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ModelBudget } from "./types.js";
import type { TokenCounter } from "./token-counter.js";
import { effectiveContentBudget } from "./token-budget.js";
import { processContent } from "./content-processor.js";
import { extractPDF } from "./pdf-extractor.js";
import { buildFetchResponse } from "./format.js";
import { cleanExpiredSpillover } from "./spillover.js";
import { safeFetch, readBoundedArrayBuffer, readBoundedText } from "./safe-fetch.js";

interface FetchParams {
  url: string;
}

export function createFetchTool(
  getBudget: () => ModelBudget,
  getCounter: () => TokenCounter,
) {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract readable text content from a web page URL. Use after web_search to read full documentation pages, blog posts, READMEs, or release notes. Returns clean markdown with structured sections.",
    promptSnippet:
      "Fetch and extract readable content from a URL (docs, blog posts, READMEs)",
    promptGuidelines: [
      "Use web_fetch to read the full content of a URL returned by web_search.",
      "Do not fetch URLs speculatively — only fetch when the content is needed to answer the user's question.",
      "If content is truncated, check the spillover path in details for full content.",
    ],
    parameters: Type.Object({
      url: Type.String({
        description: "Full URL to fetch (must include https://)",
        pattern: "^https://",
      }),
    }),

    async execute(_toolCallId: string, _params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
      const params = _params as FetchParams;
      const cwd = ctx.cwd;

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
        return buildFetchResponse(response.url, extracted, budget);
      }

      // ── HTML path ─────────────────────────────────────────────────────
      const html = await readBoundedText(response);
      const extracted = await processContent(html, response.url, budget, counter, cwd);
      return buildFetchResponse(response.url, extracted, budget);
    },
  };
}
