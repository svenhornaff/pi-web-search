/**
 * Retry wrapper for transient network failures.
 *
 * `fetch()` does not throw on HTTP error statuses — it resolves with
 * `response.ok === false`. So a retry loop that only wraps the `fetch()`
 * call and inspects thrown errors can never retry 429/502/503/504: those
 * live in the resolved `Response`, not in an exception. `fetchWithRetry`
 * inspects `response.status` directly and retries in-loop, honoring
 * `Retry-After` on 429s. Transport-level failures (ECONNRESET, timeouts,
 * DNS hiccups) are still retried via the caught-error path.
 */

export interface FetchRetryOptions {
  retries?: number;
  delayMs?: number;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const retries = Math.max(0, options.retries ?? 2);
  const delayMs = Math.max(0, options.delayMs ?? 400);
  let attempt = 0;

  while (true) {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) {
        throw error;
      }
      await delay(delayMs * (attempt + 1));
      attempt += 1;
      continue;
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
      await response.body?.cancel().catch(() => {});
      await delay(retryDelayMs(response, delayMs, attempt));
      attempt += 1;
      continue;
    }

    return response;
  }
}

function retryDelayMs(response: Response, base: number, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return base * (attempt + 1);
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("eai_again") ||
    message.includes("etimedout") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("fetch failed")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
