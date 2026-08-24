/**
 * Markdown section parser and ranker.
 * Splits markdown by headings and ranks sections by importance.
 */

import type { Section, RankingHints } from "./types.js";
import { estimateTokensQuick } from "./token-counter.js";
import type { Provider } from "./types.js";

/** Parse markdown into sections by headings */
export function parseMarkdownSections(
  markdown: string,
  provider: Provider,
): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentSection: {
    title: string;
    level: number;
    content: string;
    startLine: number;
  } | null = null;
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber++;

    // Match ATX-style headings (## Heading)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentSection && currentSection.content) {
        sections.push({
          id: `section-${sections.length}`,
          title: currentSection.title,
          level: currentSection.level,
          content: currentSection.content.trim(),
          startLine: currentSection.startLine,
          tokens: estimateTokensQuick(currentSection.content, provider),
          rank: 0, // Will be set by rankSections
          included: false,
        });
      }

      // Start new section
      currentSection = {
        title: headingMatch[2]?.trim() || "Untitled",
        level: headingMatch[1]?.length || 1,
        content: line + "\n",
        startLine: lineNumber,
      };
    } else if (currentSection) {
      currentSection.content += line + "\n";
    } else {
      // Content before first heading → implicit introduction section
      if (!currentSection && line.trim()) {
        currentSection = {
          title: "Introduction",
          level: 1,
          content: line + "\n",
          startLine: lineNumber,
        };
      }
    }
  }

  // Save final section
  if (currentSection && currentSection.content) {
    sections.push({
      id: `section-${sections.length}`,
      title: currentSection.title,
      level: currentSection.level,
      content: currentSection.content.trim(),
      startLine: currentSection.startLine,
      tokens: estimateTokensQuick(currentSection.content, provider),
      rank: 0,
      included: false,
    });
  }

  return sections;
}

/** Rank sections by importance */
export function rankSections(
  sections: Section[],
  hints: RankingHints,
  promptHint?: string,
): Section[] {
  // Pre-compute prompt tokens for lexical boost (answer mode).
  // Split the prompt into meaningful words (3+ chars, de-duped) and check each
  // against section title + content. Simple lexical overlap — no embeddings.
  const promptTokens: string[] = promptHint
    ? [...new Set(
        promptHint
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length >= 3),
      )]
    : [];

  return sections.map((section) => {
    let rank = 100; // Base rank

    // Prioritize by heading level (h1 > h2 > h3)
    rank += (4 - section.level) * 20;

    // Keyword matching
    const lowerTitle = section.title.toLowerCase();
    const lowerContent = section.content.toLowerCase();

    // Prioritize important sections
    for (const keyword of hints.prioritize) {
      if (lowerTitle.includes(keyword.toLowerCase())) {
        rank += 50;
        break; // Only apply once
      }
    }

    // Deprioritize unimportant sections
    for (const keyword of hints.deprioritize) {
      if (lowerTitle.includes(keyword.toLowerCase())) {
        rank -= 30;
        break;
      }
    }

    // Boost code-heavy sections (for technical docs)
    const codeBlockCount = (section.content.match(/```/g) || []).length / 2;
    rank += Math.min(codeBlockCount * 10, 30); // Cap at +30

    // Penalize very short sections (likely navigation)
    if (section.tokens < 50) {
      rank -= 20;
    }

    // Boost sections with tables
    if (section.content.includes("|")) {
      rank += 15;
    }

    // Answer-mode boost: sections whose title or content matches prompt words
    // are surfaced first. Each matching token contributes up to +20 (capped at
    // +60 total so a very long prompt doesn't overwhelm structural signals).
    if (promptTokens.length > 0) {
      let promptBoost = 0;
      for (const token of promptTokens) {
        if (lowerTitle.includes(token)) promptBoost += 20;
        else if (lowerContent.includes(token)) promptBoost += 10;
      }
      rank += Math.min(promptBoost, 60);
    }

    return { ...section, rank };
  });
}

/** Default ranking hints for technical documentation */
export const DEFAULT_RANKING_HINTS: RankingHints = {
  prioritize: [
    "introduction",
    "getting started",
    "quickstart",
    "overview",
    "api",
    "reference",
    "examples",
    "tutorial",
    "usage",
    "installation",
  ],
  deprioritize: [
    "footer",
    "navigation",
    "nav",
    "related",
    "advertisement",
    "sidebar",
    "comments",
    "discussion",
  ],
};
