/**
 * RSC / Next.js flight-data parser.
 *
 * Next.js App Router pages ship a shell HTML document with virtually no
 * readable text, plus a series of inline scripts that push the React Server
 * Component (RSC) flight payload into `self.__next_f`:
 *
 *   <script>self.__next_f.push([1,"...flight data..."])</script>
 *
 * The flight data is a line-delimited JSON stream where each line is a
 * React element descriptor. Text content is embedded as plain strings inside
 * the descriptors.
 *
 * This parser extracts those text strings and reassembles them as plain
 * markdown, avoiding the Jina fallback for pages that are fully present in
 * the HTML — just not in a form `linkedom` + Turndown can parse.
 *
 * Returns null when:
 *   - No `__next_f` scripts are found (not a Next.js page, or old Pages Router)
 *   - Extracted text is shorter than the min threshold (extraction failed)
 */

/** Minimum character count to consider RSC extraction successful */
const MIN_RSC_CHARS = 200;

/** Match self.__next_f.push([N,"...content..."]) */
const NEXT_F_RE = /self\.__next_f\.push\(\[(\d+),\s*"((?:[^"\\]|\\.)*)"\]\)/gs;

/**
 * Try to extract readable text from Next.js RSC flight data embedded in HTML.
 * Returns cleaned text if successful, null otherwise.
 */
export function extractRscContent(html: string): string | null {
  const chunks: string[] = [];

  let match: RegExpExecArray | null;
  NEXT_F_RE.lastIndex = 0;

  while ((match = NEXT_F_RE.exec(html)) !== null) {
    const type = Number(match[1]);
    const raw = match[2];
    if (!raw) continue;

    // Type 1 = RSC payload (the main content stream)
    // Type 0 = router patches (skip — not content)
    if (type !== 1) continue;

    // Unescape the JSON string value
    let decoded: string;
    try {
      // The string is JSON-encoded: unescape it by wrapping in quotes and parsing
      decoded = JSON.parse(`"${raw}"`) as string;
    } catch {
      continue;
    }

    chunks.push(decoded);
  }

  if (chunks.length === 0) return null;

  const combined = chunks.join("\n");
  const text = extractTextFromFlightData(combined);

  return text.length >= MIN_RSC_CHARS ? text : null;
}

/**
 * Extract plain text strings from RSC flight-data lines.
 *
 * Flight data is a newline-delimited stream of JSON rows:
 *   0:{"key":"...","value":...}    — module metadata
 *   1:"text content here"          — plain text nodes
 *   2:["$","div",null,{...}]       — React element
 *
 * We extract string literals from rows and from element children recursively,
 * filtering out React internals ($, $$typeof, etc.).
 */
function extractTextFromFlightData(data: string): string {
  const textParts: string[] = [];
  const lines = data.split("\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const payload = line.slice(colonIdx + 1).trim();
    if (!payload) continue;

    try {
      const parsed: unknown = JSON.parse(payload);
      collectText(parsed, textParts);
    } catch {
      // Not valid JSON — might be partial; try extracting quoted strings
      const quoted = payload.match(/"([^"\\]{20,})"/g);
      if (quoted) {
        for (const q of quoted) {
          const inner = q.slice(1, -1);
          if (isReadableText(inner)) textParts.push(inner);
        }
      }
    }
  }

  // Join with newlines, collapse excessive whitespace
  return textParts
    .filter((t) => t.trim().length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Recursively collect readable text strings from a parsed RSC value */
function collectText(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (isReadableText(value)) out.push(value);
    return;
  }

  if (Array.isArray(value)) {
    // React element: ["$", "tag", key, props, ...children]
    // Skip the first two elements ("$" and tag name)
    const start = typeof value[0] === "string" && value[0].startsWith("$") ? 2 : 0;
    for (let i = start; i < value.length; i++) {
      collectText(value[i], out);
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectText(v, out);
    }
  }
}

/** Filter out React internals and noise */
function isReadableText(text: string): boolean {
  if (text.length < 5) return false;
  // Skip React internals
  if (text.startsWith("$") || text.startsWith("__")) return false;
  // Skip URLs and JSON-looking strings
  if (text.startsWith("http") || text.startsWith("{") || text.startsWith("[")) return false;
  // Must have some alphabetic content
  return /[a-zA-Z]{3,}/.test(text);
}
