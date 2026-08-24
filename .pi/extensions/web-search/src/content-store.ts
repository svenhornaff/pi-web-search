/**
 * In-session content store for previously-fetched full page content.
 *
 * When web_fetch truncates a response (content exceeds the token budget),
 * it saves the full markdown here keyed by a short handle. The model can
 * then call get_fetch_content with the handle to retrieve specific sections
 * without a second network round-trip.
 *
 * The store is scoped to the current session — cleared on session_start
 * via the same pattern as SearchCache. Entries expire after 30 minutes
 * of inactivity (last access time).
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface StoredContent {
  url: string;
  title?: string;
  markdown: string;
  storedAt: number;
  lastAccessedAt: number;
}

export class ContentStore {
  private entries = new Map<string, StoredContent>();
  private counter = 0;

  /** Store full markdown and return a short handle. */
  store(url: string, markdown: string, title?: string): string {
    this.counter += 1;
    const handle = `wf${this.counter}`;
    this.entries.set(handle, {
      url,
      title,
      markdown,
      storedAt: Date.now(),
      lastAccessedAt: Date.now(),
    });
    return handle;
  }

  /** Retrieve stored content by handle, or null if not found / expired. */
  get(handle: string): StoredContent | null {
    const entry = this.entries.get(handle);
    if (!entry) return null;

    if (Date.now() - entry.storedAt > TTL_MS) {
      this.entries.delete(handle);
      return null;
    }

    entry.lastAccessedAt = Date.now();
    return entry;
  }

  /** Number of live entries. */
  size(): number {
    return this.entries.size;
  }

  /** Clear all entries (called on session_start). */
  clear(): void {
    this.entries.clear();
    this.counter = 0;
  }

  /** Evict entries older than TTL. */
  evictExpired(): void {
    const now = Date.now();
    for (const [handle, entry] of this.entries) {
      if (now - entry.storedAt > TTL_MS) {
        this.entries.delete(handle);
      }
    }
  }

  /** List all live handles with their URL and title. */
  list(): Array<{ handle: string; url: string; title?: string; storedAt: number }> {
    const now = Date.now();
    const result = [];
    for (const [handle, entry] of this.entries) {
      if (now - entry.storedAt <= TTL_MS) {
        result.push({ handle, url: entry.url, title: entry.title, storedAt: entry.storedAt });
      }
    }
    return result;
  }
}
