/**
 * Hardened fetch for arbitrary, user/model-supplied URLs.
 *
 * Wraps `fetchWithRetry` with:
 *   - `redirect: "manual"` and per-hop SSRF validation, so a redirect to a
 *     blocked target is rejected *before* that hop's request ever fires.
 *   - **Resolved-IP pinning** (DNS-rebinding TOCTOU fix): `validateFetchUrl()`
 *     returns the IP it validated; `safeFetch` builds a per-request undici
 *     `Agent` whose `connect.lookup` always returns that exact IP, so the
 *     socket dials the address we approved — not whatever a second DNS lookup
 *     would return a moment later.
 *   - A hard cap on response body size, enforced via `Content-Length` when
 *     present and by aborting the stream mid-read otherwise.
 */

import { Agent } from "undici";
import { isIP } from "node:net";
import { fetchWithRetry, type FetchRetryOptions } from "./retry.js";
import { validateFetchUrl } from "./ssrf.js";

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions extends FetchRetryOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Build a per-request undici Agent that pins connections to `resolvedIp`.
 * The agent's `connect.lookup` always returns the pre-validated IP, bypassing
 * the system resolver and closing the DNS-rebinding TOCTOU window.
 */
function buildPinnedAgent(resolvedIp: string): Agent {
  const family = isIP(resolvedIp) as 4 | 6 | 0;
  return new Agent({
    connect: {
      lookup: (_host, _opts, cb) =>
        cb(null, [{ address: resolvedIp, family: family === 6 ? 6 : 4 }]),
    },
  });
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  let validated = await validateFetchUrl(url);

  for (let hop = 0; ; hop++) {
    const pinnedAgent = buildPinnedAgent(validated.resolvedIp);
    const response = await fetchWithRetry(
      validated.url,
      {
        headers: options.headers,
        signal: options.signal,
        redirect: "manual",
        // @ts-expect-error — undici dispatcher option is not in the global fetch types
        dispatcher: pinnedAgent,
      },
      { retries: options.retries, delayMs: options.delayMs },
    );

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    await response.body?.cancel().catch(() => {});

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Redirect (${response.status}) from ${validated.url.toString()} had no Location header`);
    }
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects fetching ${url}`);
    }

    validated = await validateFetchUrl(new URL(location, validated.url).toString());
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
