/**
 * Core types for web search extension.
 * Shared across all modules.
 */

/** Supported LLM providers */
export type Provider = "anthropic" | "openai" | "google" | "unknown";

/** Token counting strategies */
export type TokenCountMode = "local_exact" | "heuristic";

/** Model-specific token budget configuration */
export interface ModelBudget {
  provider: Provider;
  model: string;
  contextWindow: number;
  outputReserve: number;
  toolReserve: number;
  safetyMargin: number;
  maxContentTokens: number;
}

/** Content section from markdown parsing */
export interface Section {
  id: string;
  title: string;
  level: number;
  content: string;
  startLine: number;
  tokens: number;
  rank: number;
  included: boolean;
}

/** Spillover metadata for cached full content */
export interface SpilloverMetadata {
  path: string;
  format: "markdown";
  expiresAt: string;
  totalSections: number;
  excludedSections: string[];
}

/** Extracted content with metadata */
export interface ExtractedContent {
  summary: string;
  /** Budget-selected (possibly truncated) markdown returned to the model. */
  mainContent: string;
  /** Full pre-truncation markdown — present only when content was truncated.
   * Stored in ContentStore so get_fetch_content can return the real full text. */
  fullMarkdown?: string;
  metadata: {
    title?: string;
    url: string;
    totalTokens: number;
    returnedTokens: number;
    truncated: boolean;
    sections: Array<{
      title: string;
      level: number;
      startLine: number;
      tokens: number;
      included: boolean;
      rank: number;
    }>;
    spillover?: SpilloverMetadata;
  };
}

/** Section ranking hints */
export interface RankingHints {
  prioritize: string[];
  deprioritize: string[];
}
