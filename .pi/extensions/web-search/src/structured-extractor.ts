/**
 * Fast structured-data extraction from raw HTML.
 *
 * Runs on the raw HTML string before any DOM parsing — pure regex,
 * no dependencies, sub-millisecond. Targets three sources in priority order:
 *
 *   1. JSON-LD  (<script type="application/ld+json">)
 *      Best for: npm/PyPI package pages, GitHub releases, documentation sites
 *
 *   2. OpenGraph meta tags  (og:title, og:description, article:published_time)
 *      Best for: blog posts, release notes, news articles
 *
 *   3. <meta name="description">
 *      Universal fallback — almost every page has one
 *
 * Returns null if nothing useful is found, so the caller can fall through
 * to full DOM extraction without any overhead cost.
 */

export interface StructuredData {
  title?: string;
  description?: string;
  publishedTime?: string;
  type?: string; // e.g. "SoftwareSourceCode", "Article", "WebPage"
}

// ── JSON-LD ────────────────────────────────────────────────────────────────

/** Safely coerce an unknown JSON value to a non-empty string or undefined */
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const JSON_LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function extractJsonLd(html: string): StructuredData | null {
  let match: RegExpExecArray | null;
  // A page can have multiple JSON-LD blocks; try each until one yields data
  while ((match = JSON_LD_RE.exec(html)) !== null) {
    try {
      const raw = match[1];
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      const node = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>;
      if (!node || typeof node !== "object") continue;

      const title = str(node["name"] ?? node["headline"]);
      const description = str(node["description"]);
      const publishedTime = str(node["datePublished"] ?? node["dateCreated"]);
      const type = str(node["@type"]);

      if (title || description) {
        JSON_LD_RE.lastIndex = 0; // reset before every return path
        return { title, description, publishedTime, type };
      }
    } catch {
      // Malformed JSON — try next block
    }
  }
  JSON_LD_RE.lastIndex = 0;
  return null;
}

// ── OpenGraph ──────────────────────────────────────────────────────────────

function extractMeta(html: string, property: string): string | undefined {
  // Matches both property= and name= variants
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return re.exec(html)?.[1]?.trim() || undefined;
}

function extractOpenGraph(html: string): StructuredData | null {
  const title = extractMeta(html, "og:title") ?? extractMeta(html, "twitter:title");
  const description = extractMeta(html, "og:description") ?? extractMeta(html, "twitter:description");
  const publishedTime = extractMeta(html, "article:published_time");
  const type = extractMeta(html, "og:type");

  return title || description ? { title, description, publishedTime, type } : null;
}

// ── Meta description fallback ──────────────────────────────────────────────

function extractMetaDescription(html: string): StructuredData | null {
  const description = extractMeta(html, "description");
  return description ? { description } : null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract structured metadata from raw HTML.
 * Returns null if no useful data is found.
 */
export function extractStructuredData(html: string): StructuredData | null {
  return extractJsonLd(html) ?? extractOpenGraph(html) ?? extractMetaDescription(html);
}
