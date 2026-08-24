/**
 * Token budget calculation — pure ratio math only.
 *
 * All model-specific data (contextWindow, maxTokens, provider) comes from
 * the `model_select` event at runtime.  This module contains no hardcoded
 * model tables — it computes the safe content-token budget from whatever
 * numbers the platform provides.
 *
 * When the model is not yet known (before `model_select` fires), callers
 * should use the UNKNOWN_DEFAULTS.
 */

import type { ModelBudget, Provider } from "./types.js";

// ── Reserve ratios ─────────────────────────────────────────────────────────

/** Fraction of contextWindow reserved for tool-use overhead */
const TOOL_RESERVE_RATIO = 0.05;

/** Fraction of contextWindow used as a safety margin */
const SAFETY_MARGIN = 0.05;

// ── Unknown / pre-model_select defaults ────────────────────────────────────

/** Conservative defaults used before model_select fires. */
export const UNKNOWN_DEFAULTS = {
  contextWindow: 100_000,
  maxTokens: 4_000,
  provider: "unknown" as Provider,
} as const;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a ModelBudget from the model's own context-window and output-token
 * limits.  All values come from the pi `model_select` event payload
 * (`event.model.contextWindow`, `event.model.maxTokens`, `event.model.provider`).
 *
 * The math:
 *   maxContentTokens = (contextWindow − outputReserve − toolReserve) × (1 − safetyMargin)
 *
 * where:
 *   outputReserve = maxTokens          (from the model)
 *   toolReserve   = contextWindow × 5%
 *   safetyMargin  = 5%
 */
export function buildBudget(
  model: string,
  contextWindow: number,
  maxTokens: number,
  provider: Provider | string,
): ModelBudget {
  const outputReserve = maxTokens;
  const toolReserve = Math.floor(contextWindow * TOOL_RESERVE_RATIO);
  const safetyMargin = SAFETY_MARGIN;

  const normalizedProvider = normalizeProvider(provider);

  const maxContentTokens = Math.max(
    0,
    Math.floor(
      (contextWindow - outputReserve - toolReserve) * (1 - safetyMargin),
    ),
  );

  return {
    model,
    provider: normalizedProvider,
    contextWindow,
    outputReserve,
    toolReserve,
    safetyMargin,
    maxContentTokens,
  };
}

/**
 * Compute an effective content token limit that accounts for how much
 * context the session has already consumed.
 *
 * When `usedTokens` is known (from `ctx.getContextUsage().tokens`), the
 * available space is:
 *   available = contextWindow − usedTokens − outputReserve
 *
 * We never exceed the static `maxContentTokens` even if the session is
 * nearly empty — that cap already includes safety and tool reserves.
 *
 * Returns `budget.maxContentTokens` unchanged when usage is unknown.
 */
export function effectiveContentBudget(
  budget: ModelBudget,
  usedTokens: number | null | undefined,
): number {
  if (usedTokens == null) return budget.maxContentTokens;

  const available = Math.max(
    0,
    budget.contextWindow - usedTokens - budget.outputReserve,
  );
  // Never exceed the static budget (it accounts for tool + safety reserves)
  return Math.min(available, budget.maxContentTokens);
}

/**
 * Build a conservative budget for when the model is not yet known.
 */
export function buildUnknownBudget(model = "unknown"): ModelBudget {
  return buildBudget(
    model,
    UNKNOWN_DEFAULTS.contextWindow,
    UNKNOWN_DEFAULTS.maxTokens,
    UNKNOWN_DEFAULTS.provider,
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Map an arbitrary provider string to our Provider union. */
function normalizeProvider(provider: Provider | string): Provider {
  const lower = provider.toLowerCase();
  if (lower === "anthropic" || lower === "amazon-bedrock") return "anthropic";
  if (
    lower === "openai" ||
    lower === "azure-openai-responses" ||
    lower === "openai-codex" ||
    lower === "deepseek" ||
    lower === "groq" ||
    lower === "together"
  )
    return "openai";
  if (lower === "google" || lower === "google-vertex") return "google";
  return "unknown";
}
