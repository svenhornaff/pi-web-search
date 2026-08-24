/**
 * JSON config file loader for web-search.
 *
 * Config file location (first found wins):
 *   1. $PI_CODING_AGENT_DIR/web-search.json   (if env var is set)
 *   2. ~/.pi/web-search.json                  (default)
 *
 * Example config:
 * ```json
 * {
 *   "defaultProvider": "auto",
 *   "fallbackOrder": ["brave", "tavily"],
 *   "maxResults": 5,
 *   "maxInlineContentChars": 30000
 * }
 * ```
 *
 * All fields are optional — missing fields fall back to built-in defaults.
 * $ENV_VAR values in strings are interpolated from process.env at load time.
 *
 * Loaded once per session (on session_start). Call loadConfig() again after
 * /reload to pick up changes without restarting Pi.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderName } from "./providers/registry.js";

/** Validated, resolved config — all fields present with defaults applied. */
export interface WebSearchConfig {
  /** Provider selected when none is specified. "auto" = heuristic. */
  defaultProvider: ProviderName | "auto";
  /**
   * Ordered list of providers to try in sequence when the primary fails.
   * First entry is tried first; subsequent entries are fallbacks.
   */
  fallbackOrder: ProviderName[];
  /** Default number of results (overridable per-call). */
  maxResults: number;
  /** Maximum inline content characters returned by web_fetch before spillover. */
  maxInlineContentChars: number;
}

const DEFAULTS: WebSearchConfig = {
  defaultProvider: "auto",
  fallbackOrder: ["brave", "tavily"],
  maxResults: 5,
  maxInlineContentChars: 30_000,
};

const VALID_PROVIDERS: Set<string> = new Set(["brave", "tavily"]);

/** Raw shape from the JSON file — all fields optional and unvalidated. */
interface RawConfig {
  defaultProvider?: unknown;
  fallbackOrder?: unknown;
  maxResults?: unknown;
  maxInlineContentChars?: unknown;
}

/** Interpolate $ENV_VAR references in a string value. */
function interpolateEnv(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name: string) => {
    return process.env[name] ?? "";
  });
}

/** Resolve the config file path. */
function resolveConfigPath(): string {
  const envDir = process.env["PI_CODING_AGENT_DIR"];
  if (envDir) return resolve(envDir, "web-search.json");
  return join(homedir(), ".pi", "web-search.json");
}

/**
 * Load and validate the config file.
 * Returns defaults if the file does not exist or is malformed.
 * Never throws — config errors are soft failures.
 */
export async function loadConfig(): Promise<WebSearchConfig> {
  const configPath = resolveConfigPath();

  let raw: RawConfig;
  try {
    const text = await readFile(configPath, "utf-8");
    const interpolated = interpolateEnv(text);
    raw = JSON.parse(interpolated) as RawConfig;
  } catch {
    // File not found or parse error — use defaults silently.
    return { ...DEFAULTS };
  }

  const config: WebSearchConfig = { ...DEFAULTS };

  // defaultProvider
  if (
    typeof raw.defaultProvider === "string" &&
    (raw.defaultProvider === "auto" || VALID_PROVIDERS.has(raw.defaultProvider))
  ) {
    config.defaultProvider = raw.defaultProvider as WebSearchConfig["defaultProvider"];
  }

  // fallbackOrder
  if (Array.isArray(raw.fallbackOrder)) {
    const valid = raw.fallbackOrder.filter(
      (p): p is ProviderName => typeof p === "string" && VALID_PROVIDERS.has(p),
    );
    if (valid.length > 0) config.fallbackOrder = valid;
  }

  // maxResults
  if (typeof raw.maxResults === "number" && raw.maxResults >= 1 && raw.maxResults <= 20) {
    config.maxResults = Math.floor(raw.maxResults);
  }

  // maxInlineContentChars
  if (
    typeof raw.maxInlineContentChars === "number" &&
    raw.maxInlineContentChars >= 1000
  ) {
    config.maxInlineContentChars = Math.floor(raw.maxInlineContentChars);
  }

  return config;
}
