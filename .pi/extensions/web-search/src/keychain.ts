/**
 * API key resolution — cross-platform.
 *
 * Resolution order:
 *   1. macOS Keychain (only on macOS — skipped entirely on other platforms)
 *   2. Environment variable
 *   3. Workspace .env file
 *
 * Store a key (macOS):
 *   security add-generic-password -a "$USER" -s "brave-api-key" -w "YOUR_KEY" -U
 *
 * Verify it works (macOS):
 *   security find-generic-password -a "$USER" -s "brave-api-key" -w
 *
 * Supported keys and their env vars:
 *   EXA_API_KEY       — service "exa-api-key"
 *   BRAVE_API_KEY     — service "brave-api-key"
 *   TAVILY_API_KEY    — service "tavily-api-key"
 *   JINA_API_KEY      — service "jina-api-key"  (optional; enables authenticated
 *                        Jina Reader rate tier when Tavily Extract unavailable)
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const IS_MACOS = process.platform === "darwin";

/** In-memory cache so we hit Keychain only once per session. */
const cache = new Map<string, string>();

/**
 * Read a password from macOS Keychain.
 * Returns `undefined` on non-macOS platforms or if the entry doesn't exist.
 */
async function readKeychain(
  service: string,
  account?: string,
): Promise<string | undefined> {
  if (!IS_MACOS) return undefined;

  const cacheKey = `${service}:${account ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  return new Promise((res) => {
    const args = ["find-generic-password", "-s", service, "-w"];
    if (account) {
      args.splice(1, 0, "-a", account);
    }

    execFile("/usr/bin/security", args, { timeout: 5_000 }, (error, stdout) => {
      if (error) {
        res(undefined);
        return;
      }
      const value = stdout.trim();
      if (value) {
        cache.set(cacheKey, value);
        res(value);
      } else {
        res(undefined);
      }
    });
  });
}

export interface KeychainConfig {
  /** Keychain service name (e.g. "brave-api-key") */
  keychainService: string;
  /** Keychain account — defaults to $USER */
  keychainAccount?: string;
  /** Fallback environment variable name */
  envVar: string;
  /** Human-readable name for error messages */
  displayName: string;
}

/**
 * Load environment variables from workspace .env file if it exists.
 * Accepts an explicit `cwd` so callers can pass `ctx.cwd` instead of
 * relying on `process.cwd()`.
 */
async function loadEnvFile(
  cwd?: string,
): Promise<Record<string, string>> {
  try {
    const envPath = resolve(cwd ?? process.cwd(), ".env");
    const content = await readFile(envPath, "utf-8");

    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (match) {
        const key = match[1];
        const value = match[2];
        if (key && value) {
          vars[key] = value.replace(/^["']|["']$/g, "");
        }
      }
    }
    return vars;
  } catch {
    return {};
  }
}

/**
 * Resolve an API key.
 *
 * @param config  Key configuration
 * @param cwd    Working directory for .env lookup (default: process.cwd())
 * @throws Error if key is not found in any location
 */
export async function resolveApiKey(
  config: KeychainConfig,
  cwd?: string,
): Promise<string> {
  // 1. Try macOS Keychain (no-op on other platforms)
  const keychainValue = await readKeychain(
    config.keychainService,
    config.keychainAccount ?? process.env["USER"],
  );
  if (keychainValue) return keychainValue;

  // 2. Fall back to environment variable
  const envValue = process.env[config.envVar];
  if (envValue) return envValue;

  // 3. Fall back to workspace .env file
  const envFile = await loadEnvFile(cwd);
  if (config.envVar in envFile) {
    const envFileValue = envFile[config.envVar];
    if (envFileValue) return envFileValue;
  }

  // 4. None found — platform-appropriate error message
  const hints = [
    `${config.displayName} not found.\n`,
  ];

  if (IS_MACOS) {
    hints.push(
      `Option 1 — macOS Keychain:\n` +
      `  security add-generic-password -a "$USER" -s "${config.keychainService}" -w "YOUR_KEY" -U\n`,
    );
  }

  hints.push(
    `Option ${IS_MACOS ? "2" : "1"} — Environment variable:\n` +
    `  export ${config.envVar}="YOUR_KEY"  # add to shell profile\n`,
  );

  hints.push(
    `Option ${IS_MACOS ? "3" : "2"} — Workspace .env file:\n` +
    `  echo '${config.envVar}="YOUR_KEY"' >> .env`,
  );

  throw new Error(hints.join("\n"));
}
