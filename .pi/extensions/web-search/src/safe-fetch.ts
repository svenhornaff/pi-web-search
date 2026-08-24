/**
 * Hardened fetch for arbitrary, user/model-supplied URLs.
 *
 * Wraps `fetchWithRetry` with:
 *   - `redirect: "manual"` and per-hop SSRF validation, so a redirect to a
 *     blocked target is rejected *before* that hop's request ever fires
 *     (validating only `response.url` after `redirect: "follow"` is
 *     post-hoc — the request already happened by the time you can check).
 *   - a hard cap on response body size, enforced via `Content-Length` when
 *     present and by aborting the stream read once the cap is exceeded
 *     otherwise (a server can omit or lie about `Content-Length`).
 *
 * Known limitation (documented, not fixed here): validation resolves the
 * hostname and `fetch()` resolves it again independently, so a DNS answer
 * that changes between the two lookups (DNS rebinding) is not caught. A
 * full fix needs resolved-IP pinning (e.g. a custom undici Agent) — out of
 * scope while the guard already blocks every non-rebinding SSRF path.
 */

import { fetchWithRetry, type FetchRetryOptions } from "./retry.js";
import { validateFetchUrl } from "./ssrf.js";

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions extends FetchRetryOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  let target = await validateFetchUrl(url);

  for (let hop = 0; ; hop++) {
    const response = await fetchWithRetry(
      target,
      {
        headers: options.headers,
        signal: options.signal,
        redirect: "manual",
      },
      { retries: options.retries, delayMs: options.delayMs },
    );

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    await response.body?.cancel().catch(() => {});

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Redirect (${response.status}) from ${target.toString()} had no Location header`);
    }
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects fetching ${url}`);
    }

    target = await validateFetchUrl(new URL(location, target).toString());
  }
}

/**
 * Read a response body up to `maxBytes`. Throws instead of buffering an
 * oversized body into memory.
 */
export async function readBoundedArrayBuffer(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Response too large: ${declared} bytes exceeds ${maxBytes}-byte limit`);
    }
  }

  if (!response.body) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response exceeded ${maxBytes}-byte limit while streaming`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export async function readBoundedText(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const buffer = await readBoundedArrayBuffer(response, maxBytes);
  return new TextDecoder().decode(buffer);
}
