/**
 * PDF text extraction using pdf-parse.
 *
 * Returns an ExtractedContent with the same shape as processContent()
 * so the web_fetch response path is identical for HTML and PDF URLs.
 *
 * Extraction strategy:
 *   - Full text via PDFParse.getText() — plain text, page-separated
 *   - Each page becomes a Section so the token-budget + spillover pipeline
 *     works without modification
 *   - Page separators ("-- N of M --") are stripped from the output
 */

import { PDFParse } from "pdf-parse";
import type { ModelBudget, ExtractedContent, Section } from "./types.js";
import type { TokenCounter } from "./token-counter.js";
import { estimateTokensQuick } from "./token-counter.js";
import { selectSections } from "./section-selector.js";
import { writeSpillover } from "./spillover.js";

/** Extract text from a PDF buffer and return structured content */
export async function extractPDF(
  buffer: ArrayBuffer,
  url: string,
  budget: ModelBudget,
  counter: TokenCounter,
  cwd?: string,
): Promise<ExtractedContent> {
  const parser = new PDFParse({ data: buffer });

  let rawText: string;
  let pageCount: number;

  try {
    const result = await parser.getText();
    rawText = result.text;
    pageCount = result.total;
  } finally {
    await parser.destroy().catch(() => {});
  }

  // Split into per-page sections — PDFParse separates pages with "-- N of M --"
  const sections = buildSections(rawText, pageCount, budget);

  // Select pages within token budget (shared implementation — ranked by importance)
  const selected = await selectSections(
    sections,
    budget.maxContentTokens,
    counter,
    "\n\n---\n\n",
  );

  let spillover;
  if (selected.truncated) {
    spillover = await writeSpillover(rawText, selected.sections, url, cwd);
  }

  // Use the filename or last URL path segment as the title
  const filename = decodeURIComponent(url.split("/").pop() ?? "").replace(/\.pdf$/i, "") || "PDF Document";

  return {
    summary: `PDF document — ${pageCount} page${pageCount === 1 ? "" : "s"}`,
    mainContent: selected.markdown,
    // Preserve full pre-truncation text so ContentStore can serve it via
    // get_fetch_content without a second network round-trip.
    ...(selected.truncated ? { fullMarkdown: rawText } : {}),
    metadata: {
      title: filename,
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

// ── Helpers ────────────────────────────────────────────────────────────────

/** Page separator pattern emitted by pdf-parse between pages */
const PAGE_SEP_RE = /\n-- \d+ of \d+ --\n?/g;

function buildSections(rawText: string, pageCount: number, budget: ModelBudget): Section[] {
  // Split on page separators — each page becomes one section
  const pages = rawText.split(PAGE_SEP_RE).map((p) => p.trim()).filter(Boolean);

  // If the PDF has no separators (single page or unusual format), treat as one section
  if (pages.length === 0) pages.push(rawText.trim());

  let lineNumber = 0;
  return pages.map((content, i) => {
    const startLine = lineNumber;
    lineNumber += content.split("\n").length + 1;
    return {
      id: `page-${i + 1}`,
      title: `Page ${i + 1}${pageCount > 1 ? ` of ${pageCount}` : ""}`,
      level: 1,
      content,
      startLine,
      tokens: estimateTokensQuick(content, budget.provider),
      rank: pageCount - i, // earlier pages ranked higher
      included: false,
    };
  });
}

