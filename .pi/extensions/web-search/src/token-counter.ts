/**
 * Token counter with provider-aware strategies.
 *
 * Two tiers:
 *   1. js-tiktoken (offline, OpenAI-compatible models) — local exact
 *   2. Heuristic (character-based estimation) — all others
 *
 * The remote Anthropic count_tokens API was removed in 0.3.6:
 *   - Marginal accuracy gain over heuristic (3.5 chars/token is close enough
 *     for section-selection budgeting — we're not doing billing math)
 *   - Costs latency + a network call per web_fetch
 *   - Required manually managing an Anthropic API key outside pi's own auth
 *
 * If exact Anthropic counting is ever needed again, use
 * `ctx.modelRegistry.getProviderAuth("anthropic")` to get the key from pi's
 * auth system instead of managing it separately.
 */

import type { Provider, TokenCountMode } from "./types.js";

/** Token counter interface */
export interface TokenCounter {
  mode: TokenCountMode;
  provider: Provider;
  count(text: string): Promise<number>;
}

/** OpenAI local token counter — uses bundled js-tiktoken encodings (no network calls) */
export class OpenAITokenCounter implements TokenCounter {
  mode: TokenCountMode = "local_exact";
  provider: Provider = "openai";

  private encoding: { encode: (text: string) => number[] } | null = null;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  async count(text: string): Promise<number> {
    if (!this.encoding) await this.initEncoding();
    try {
      return this.encoding?.encode(text).length ?? Math.ceil(text.length / 4);
    } catch {
      return Math.ceil(text.length / 4);
    }
  }

  private async initEncoding(): Promise<void> {
    try {
      const { Tiktoken } = await import("js-tiktoken/lite");
      // Import bundled rank data — no CDN fetch, works offline
      const ranks = this.model.includes("gpt-4o")
        ? await import("js-tiktoken/ranks/o200k_base")
        : await import("js-tiktoken/ranks/cl100k_base");
      this.encoding = new Tiktoken(ranks.default);
    } catch {
      this.encoding = null; // falls back to heuristic in count()
    }
  }
}

/** Heuristic token counter (character-based estimation) */
export class HeuristicTokenCounter implements TokenCounter {
  mode: TokenCountMode = "heuristic";
  provider: Provider;
  private readonly charsPerToken: number;

  constructor(provider: Provider, charsPerToken: number = 3) {
    this.provider = provider;
    this.charsPerToken = charsPerToken;
  }

  async count(text: string): Promise<number> {
    return Math.ceil(text.length / this.charsPerToken);
  }
}

/**
 * Create appropriate token counter for provider.
 *
 * Anthropic/Google use a heuristic (3.5 chars/token). OpenAI uses local
 * tiktoken when the model is GPT-based. Everything else uses a conservative
 * 3 chars/token estimate.
 */
export function createTokenCounter(
  provider: Provider,
  model: string,
): TokenCounter {
  switch (provider) {
    case "anthropic":
      return new HeuristicTokenCounter("anthropic", 3.5);

    case "openai":
      return new OpenAITokenCounter(model);

    case "google":
      return new HeuristicTokenCounter("google", 3.5);

    case "unknown":
    default:
      return new HeuristicTokenCounter("unknown", 3);
  }
}

/** Quick estimation (heuristic only, no API calls) */
export function estimateTokensQuick(text: string, provider: Provider): number {
  const charsPerToken =
    provider === "anthropic" ? 3.5 : provider === "openai" ? 4 : 3;
  return Math.ceil(text.length / charsPerToken);
}
