/**
 * get_fetch_content tool — retrieve previously-fetched full content.
 *
 * When web_fetch truncates a page (exceeds token budget), it stores the
 * full markdown in ContentStore and returns a handle in details.handle.
 * The model calls get_fetch_content with that handle to retrieve:
 *   - The full content (optionally filtered by findText)
 *   - A specific section by index
 *   - The list of available handles (when called with no arguments)
 */

import { Type } from "@sinclair/typebox";
import type { ContentStore } from "./content-store.js";

interface GetContentParams {
  handle?: string;
  findText?: string;
  sectionIndex?: number;
}

interface GetContentDetails {
  handle?: string;
  url?: string;
  title?: string;
  found?: boolean;
  handles?: Array<{ handle: string; url: string; title?: string; storedAt: number }>;
  sectionCount?: number;
  searchTerm?: string;
  totalChars?: number;
  returnedChars?: number;
}

export function createGetContentTool(getStore: () => ContentStore) {
  return {
    name: "get_fetch_content",
    label: "Get Fetched Content",
    description:
      "Retrieve full content previously fetched by web_fetch. Use when web_fetch returned truncated content and included a handle in its details. Call without arguments to list all available handles.",
    promptSnippet:
      "Retrieve previously-fetched full page content by handle",
    promptGuidelines: [
      "Use get_fetch_content when web_fetch details include a handle field — this means content was truncated.",
      "Pass handle from web_fetch details to retrieve the full content.",
      "Use findText to search for a specific term within the stored content.",
      "Call without arguments to list all available handles from this session.",
    ],
    parameters: Type.Object({
      handle: Type.Optional(Type.String({
        description: "Handle returned by web_fetch in details.handle. Omit to list all available handles.",
      })),
      findText: Type.Optional(Type.String({
        description: "Filter content to the window around this search term (case-insensitive).",
      })),
      sectionIndex: Type.Optional(Type.Number({
        description: "Return only this section index (0-based) from the stored content.",
        minimum: 0,
      })),
    }),

    async execute(_toolCallId: string, _params: unknown): Promise<{ content: Array<{ type: "text"; text: string }>; details: GetContentDetails }> {
      const params = _params as GetContentParams;
      const store = getStore();

      // No handle — list all available
      if (!params.handle) {
        const items = store.list();
        if (items.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No content stored in this session. Call web_fetch first." }],
            details: { handles: [] },
          };
        }
        const lines = items.map((item) =>
          `- **${item.handle}**: ${item.title ?? "(untitled)"} — ${item.url}`
        );
        return {
          content: [{ type: "text" as const, text: `## Stored content handles\n\n${lines.join("\n")}` }],
          details: { handles: items },
        };
      }

      const entry = store.get(params.handle);
      if (!entry) {
        return {
          content: [{ type: "text" as const, text: `No content found for handle "${params.handle}". It may have expired (30 min TTL) or never been stored.` }],
          details: { handle: params.handle, found: false },
        };
      }

      let content = entry.markdown;

      // Section filter
      if (typeof params.sectionIndex === "number") {
        const sections = content.split(/\n(?=#+\s)/);
        const section = sections[params.sectionIndex];
        if (!section) {
          return {
            content: [{ type: "text" as const, text: `Section ${params.sectionIndex} not found. Available sections: 0–${sections.length - 1}.` }],
            details: { handle: params.handle, sectionCount: sections.length },
          };
        }
        content = section;
      }

      // Text search — return a window around the match
      if (params.findText) {
        const lower = content.toLowerCase();
        const idx = lower.indexOf(params.findText.toLowerCase());
        if (idx < 0) {
          return {
            content: [{ type: "text" as const, text: `Text "${params.findText}" not found in stored content for handle "${params.handle}".` }],
            details: { handle: params.handle, found: false, searchTerm: params.findText },
          };
        }
        const WINDOW = 3000;
        const start = Math.max(0, idx - WINDOW);
        const end = Math.min(content.length, idx + params.findText.length + WINDOW);
        content =
          (start > 0 ? "…\n\n" : "") +
          content.slice(start, end) +
          (end < content.length ? "\n\n…" : "");
      }

      const header = `## ${entry.title ?? entry.url}\n\n*Source: ${entry.url}*\n\n`;
      return {
        content: [{ type: "text" as const, text: header + content }],
        details: {
          handle: params.handle,
          url: entry.url,
          title: entry.title,
          totalChars: entry.markdown.length,
          returnedChars: content.length,
          found: true,
        },
      };
    },
  };
}
