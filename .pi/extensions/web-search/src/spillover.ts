/**
 * Spillover cache management for full content preservation.
 * Writes full markdown to .pi/cache/web-fetch/ with TTL.
 *
 * The cache directory is resolved from a `cwd` parameter passed by the
 * caller (via `ctx.cwd` in tool execute).  This ensures correctness when
 * pi changes the working directory between sessions (e.g. /resume to a
 * different project).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { Section, SpilloverMetadata } from "./types.js";

/** Relative path under the working directory for spillover files */
const CACHE_SUBDIR = ".pi/cache/web-fetch";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Resolve the cache directory from an explicit cwd, falling back to process.cwd(). */
function resolveCacheDir(cwd?: string): string {
  return path.resolve(cwd ?? process.cwd(), CACHE_SUBDIR);
}

/** Write full content to spillover cache */
export async function writeSpillover(
  markdown: string,
  sections: Section[],
  url: string,
  cwd?: string,
): Promise<SpilloverMetadata> {
  const cacheDir = resolveCacheDir(cwd);

  // Create cache directory
  await fs.mkdir(cacheDir, { recursive: true });

  // Generate unique filename
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  const timestamp = Date.now();
  const filename = `${hash}-${timestamp}.md`;
  const spilloverPath = path.join(cacheDir, filename);

  // Write content
  await fs.writeFile(spilloverPath, markdown, "utf-8");

  // Identify excluded sections
  const excludedSections = sections
    .filter((s) => !s.included)
    .map((s) => s.title);

  return {
    path: spilloverPath,
    format: "markdown",
    expiresAt: new Date(timestamp + TTL_MS).toISOString(),
    totalSections: sections.length,
    excludedSections,
  };
}

/** Clean up expired spillover files */
export async function cleanExpiredSpillover(cwd?: string): Promise<number> {
  const cacheDir = resolveCacheDir(cwd);
  try {
    const files = await fs.readdir(cacheDir);
    const now = Date.now();
    let cleanedCount = 0;

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = path.join(cacheDir, file);
      const stats = await fs.stat(filePath);

      // Check if expired
      if (now - stats.mtimeMs > TTL_MS) {
        await fs.unlink(filePath);
        cleanedCount++;
      }
    }

    return cleanedCount;
  } catch {
    // Directory doesn't exist or other error
    return 0;
  }
}
