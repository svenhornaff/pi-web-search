/**
 * HTML content extraction with Readability + Turndown.
 * Converts HTML to clean markdown while preserving code blocks and tables.
 */

import { parseHTML } from "linkedom";
import TurndownService from "turndown";
// @ts-expect-error - No types available for turndown-plugin-gfm
import { gfm } from "turndown-plugin-gfm";
import { extractStructuredData } from "./structured-extractor.js";

/** Extract clean markdown from HTML */
export async function extractMarkdown(
  html: string,
  _url: string,
): Promise<{ title: string; markdown: string; excerpt: string }> {
  // Fast pre-pass: structured data (JSON-LD, OpenGraph, meta) before any DOM work.
  // Provides richer title/excerpt than first-paragraph heuristics on most pages.
  const structured = extractStructuredData(html);

  try {
    const { document } = parseHTML(html);
    const article = extractMainContent(document);
    const markdown = htmlToMarkdown(article.content);

    // Prefer structured title if DOM title is empty or structured one is longer
    const title = structured?.title && structured.title.length > (article.title?.length ?? 0)
      ? structured.title
      : article.title || structured?.title || "";

    // Prefer structured description if it's more informative than the first paragraph
    const excerpt = structured?.description && structured.description.length > (article.excerpt?.length ?? 0)
      ? structured.description
      : article.excerpt || structured?.description || "";

    return { title, markdown, excerpt };
  } catch {
    return fallbackExtraction(html, structured ?? undefined);
  }
}

/** Simple Readability-like extraction */
function extractMainContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  document: any,
): { title: string; content: string; excerpt: string } {
  // Extract title
  const titleEl = document.querySelector("title");
  const title = titleEl?.textContent?.trim() || "";

  // Remove unwanted elements
  const selectors = [
    "script",
    "style",
    "nav",
    "header",
    "footer",
    "aside",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    ".advertisement",
    ".ad",
    ".sidebar",
  ];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      el.remove();
    }
  }

  // Find main content area
  const mainSelectors = [
    "main",
    "[role='main']",
    "article",
    ".main-content",
    ".content",
    "#content",
    "#main",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contentEl: any = null;
  for (const selector of mainSelectors) {
    contentEl = document.querySelector(selector);
    if (contentEl) break;
  }

  // Fallback to body if no main content found
  if (!contentEl) {
    contentEl = document.querySelector("body");
  }

  const content = contentEl?.innerHTML || "";

  // Extract excerpt from first paragraph
  const firstP = contentEl?.querySelector("p");
  const excerpt = firstP?.textContent?.trim().slice(0, 200) || "";

  return { title, content, excerpt };
}

/** Convert HTML to markdown */
function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });

  // Enable GitHub Flavored Markdown (tables, strikethrough)
  turndown.use(gfm);

  // Custom rule: preserve code language hints
  turndown.addRule("codeLanguage", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter: (node: any) => {
      return (
        node.nodeName === "PRE" &&
        node.firstChild?.nodeName === "CODE"
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    replacement: (content: string, node: any) => {
      const code = node.firstChild;
      if (!code) return `\n\`\`\`\n${content}\n\`\`\`\n`;

      // Extract language from class (e.g., language-python)
      const classMatch = code.className?.match(/language-(\w+)/);
      const lang = classMatch?.[1] || "";

      return `\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
    },
  });

  return turndown.turndown(html);
}

/** Fallback extraction (regex-based) */
function fallbackExtraction(
  html: string,
  structured?: { title?: string; description?: string },
): { title: string; markdown: string; excerpt: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const domTitle = titleMatch?.[1]?.trim().replace(/\s+/g, " ") || "";

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: structured?.title || domTitle,
    markdown: text,
    excerpt: structured?.description || text.slice(0, 200),
  };
}
