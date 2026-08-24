# web-search Extension Refactor Guideline

> Target: **≥ 9/10** across all criteria. Current baseline: **6.5/10** — verified against the actual codebase, holds.
>
> Benchmark: [`pi-web-access`](https://pi.dev/packages/pi-web-access) v0.24.0 (292.5K downloads/mo · 86.1K/wk, published Aug 18 2026; 25 providers, 4 tools, zero-config Exa — corrected from v0.24.1 / 325K, which was stale by a few days when this doc was drafted).
>
> Date: August 2026 · Pi v0.84.2 · Audited against source Aug 22 2026 — see audit notes marked ✅/⚠️ below.

---

## Current Scores vs. Targets

| # | Criterion | Now | Target | Key Gap |
|---|-----------|:---:|:------:|---------|
| 1 | Architecture | 7 | 9 | `index.ts` god-file, duplicated `selectSections`, singleton registry |
| 2 | Code Quality | 7 | 9 | Raw-fetch token counting, stale hardcoded model tables, no retry |
| 3 | Testing | 5 | 9 | 26% file coverage, no integration tests, stale assertions |
| 4 | Pi API Usage | 7 | 10 | `web_fetch` already reads `ctx.model?.id`; the real gaps are `ctx.getContextUsage()` (fully unused), `web_search`'s `execute` not taking `ctx` at all, pi auth, `session_start` |
| 5 | Provider Design | 8 | 9 | Only 2 providers, no zero-config, no fallback chain |
| 6 | Content Pipeline | 8 | 9 | No JS rendering fallback, no GitHub/YouTube handling |
| 7 | Documentation | 7 | 9 | Stale README tables, no config reference |
| 8 | Security | 7 | 9 | macOS-only keychain (degrades gracefully on other OSes, doesn't crash — still worth fixing), no SSRF guard, no rate limiting |
| 9 | Maintainability | 5 | 9 | Hardcoded model table, no CI, `process.cwd()` at module load (comment in the code claims the opposite of what it does — see 1.4), package.json version not bumped to match CHANGELOG |
| 10 | Feature Completeness | 6 | 9 | Missing source-check, GitHub clone, batch queries, config file |
| 11 | Ecosystem Fit | 5 | 9 | Not distributable, no `pi install`, no JSON config |
| | **Overall** | **6.5** | **9+** | |

---

## Phase 1 — Fix the Foundation (Score: 5→8)

_Goal: eliminate every "this is broken / stale / fragile" issue before adding features._

**Audit note:** every item below was checked against the actual source and test run (`npm test`: 104/105 pass, the 1 failure is exactly the `gpt-5` assertion described in 1.2). All hold up as written except where flagged ⚠️.

### 1.1 Kill the Hardcoded Model Table ✅ Done (0.3.5)

**Why:** The `MODEL_CONFIGS` / `PROVIDER_FALLBACKS` / `detectProvider` in `token-budget.ts` went stale three times. It will go stale again. pi already knows every model's context window.

**How:**
- In the `model_select` handler, read `event.model.contextWindow` and `event.model.maxTokens` directly from the event payload (pi 0.82.0+).
- Derive `provider` from `event.model.provider`.
- Store the computed `ModelBudget` in the closure. Remove `token-budget.ts` entirely or reduce it to a single `buildBudget(contextWindow, maxTokens, provider)` pure function with sensible reserve ratios.
- Fallback for `"unknown"` when `model_select` hasn't fired yet: use conservative 100K defaults.

**Test:** `getModelBudget()` becomes `buildBudget()` — test the ratio math only, not model names.

### 1.2 Fix Stale Tests ✅ Done (0.3.5)

- `token-budget.test.ts` line asserting `gpt-5` hits OpenAI fallback now fails (hits exact match at 400K). Update or delete — this test goes away entirely if 1.1 removes the model table. ✅ Confirmed: `npm test` currently reports 104 pass / 1 fail, and it's exactly this assertion.
- **Root cause, not previously called out:** today's `CHANGELOG.md` entry (0.3.4) added `claude-opus-5`, `gpt-5`, `gpt-5.5` to `MODEL_CONFIGS` to fix a real under-budgeting bug — the stale test is a direct, same-day side effect of that fix, not old drift. `package.json` still reads `"version": "0.3.3"` — bump it alongside the CHANGELOG entry that already exists for 0.3.4.
- Run `npm test` in CI. If any test fails, the PR is blocked.

### 1.3 Reset Cache on Session Lifecycle ✅ Done (0.3.5)

```ts
pi.on("session_start", () => { cache = new SearchCache(); });
```

Without this, cache from a previous `/resume`'d session leaks into the new one.

### 1.4 Fix `process.cwd()` at Module Load ✅ Done (0.3.5)

`spillover.ts` captures `CACHE_DIR = path.resolve(process.cwd(), ...)` when the module first loads. If pi changes cwd (e.g. `/resume` to a different project), spillover writes to the wrong directory. ✅ Confirmed, and worse than it sounds: the line has an inline comment reading *"Resolved once at module load — safe regardless of process.cwd() at call time"* — which asserts the opposite of what the code actually does. Fix the comment along with the bug, or the next person to touch this file will re-derive the same wrong belief from it.

**Fix:** Accept `cwd` as a parameter from the caller (read from `ctx.cwd` in `web_fetch`).

### 1.5 Extract Shared `selectSections()` ✅ Done (0.3.5)

`content-processor.ts` and `pdf-extractor.ts` each have their own `selectSections()` with nearly identical logic (one uses `\n\n`, the other `\n\n---\n\n` as separator). ⚠️ **This is a live correctness bug, not just duplication:** `content-processor.ts`'s version sorts sections by `rank` (descending) before the greedy budget fill; `pdf-extractor.ts`'s copy dropped that sort and fills in original document order. It happens to look correct today only because PDF page rank (`pageCount - i`) is currently assigned in the same order pages already appear in — the moment PDF ranking becomes content-aware instead of position-only, section selection will silently stop respecting it. Flag this at Major, not Minor, when prioritizing.

**Fix:** Create `src/section-selector.ts` with:
```ts
export async function selectSections(
  sections: Section[],
  maxTokens: number,
  counter: TokenCounter,
  separator?: string,
): Promise<SelectionResult>
```

### 1.6 Split `index.ts` (335 LOC → ~4 files) ✅ Done (0.3.5)

| New File | Responsibility |
|----------|----------------|
| `src/tool-search.ts` | `web_search` tool definition + execute |
| `src/tool-fetch.ts` | `web_fetch` tool definition + execute |
| `src/format.ts` | `formatSearchResults()`, `buildFetchResponse()` |
| `src/index.ts` | Extension factory: model tracking, tool registration, wiring |

`index.ts` should be under 80 lines after this.

---

## Phase 2 — Deep Pi Integration (Score: 7→10)

_Goal: use the platform properly instead of reimplementing it._

### 2.1 Use Pi's Auth System for Token Counting ✅ Done (0.3.6)

The `AnthropicTokenCounter` class manually calls `https://api.anthropic.com/v1/messages/count_tokens` with a raw `fetch()` and its own API key. Pi already manages Anthropic auth (including OAuth tokens from `/login`).

**Replace with:** `ctx.modelRegistry.getProviderAuth("anthropic")` to get the resolved key/headers, or better yet, just use the heuristic counter — the accuracy gain from remote counting is marginal and costs latency + a network call per fetch.

### 2.2 Use `ctx.getContextUsage()` for Dynamic Budgeting ✅ Done (0.3.6)

Instead of computing a fixed `maxContentTokens` once from the model's context window, check how much context the current session has already consumed:

```ts
const usage = ctx.getContextUsage();
const available = usage
  ? Math.max(0, budget.contextWindow - usage.tokens - budget.outputReserve)
  : budget.maxContentTokens;
```

This prevents stuffing 750K of web content into a session that already has 900K of conversation.

### 2.3 Cross-Platform Keychain ✅ Done (0.3.6)

`keychain.ts` shells out to `/usr/bin/security` — ⚠️ correction: it doesn't fail the extension on Linux/Windows, `execFile` errors are caught and it falls through to the env var / `.env` chain (confirmed in `resolveApiKey`), so functionality is preserved. The actual costs are: a doomed syscall on every cold key-lookup on non-macOS, no `process.platform` gate to skip it outright, and a misleading "Option 1 — macOS Keychain (recommended)" in the thrown error message shown to Linux/Windows users. Worth fixing for cleanliness and correct error messaging, not because it currently breaks anything. pi has `ctx.modelRegistry.getProviderAuth()` for credentials it manages. For extension-specific keys (Brave, Tavily), the resolution order should be:

1. JSON config file (`~/.pi/web-search.json` — see 3.2)
2. Environment variable
3. Workspace `.env`

Drop the macOS Keychain entirely. Or gate it behind `process.platform === "darwin"` with graceful fallback.

---

## Phase 3 — Feature Parity + Differentiation (Score: 6→9)

_Goal: match pi-web-access on the features that matter, beat it on the ones that differentiate._

### 3.1 Add Exa Provider (Zero-Config)

**Why:** Exa is the ecosystem default. pi-web-access works with zero API keys because Exa MCP is free. Our extension requires a Brave key.

**How:** Add `src/providers/exa.ts` implementing `SearchProvider`. Two modes:
- **Direct API** when `EXA_API_KEY` is configured (fast, full control).
- **MCP proxy** when no key is set (uses Exa's hosted MCP endpoint — same as pi-web-access's zero-config path). This requires calling the MCP endpoint via HTTP.

Make Exa the first provider in the `auto` fallback chain. Brave and Tavily become secondary.

### 3.2 JSON Config File

Create `~/.pi/web-search.json` (or under `PI_CODING_AGENT_DIR`):

```json
{
  "provider": "auto",
  "braveApiKey": "$BRAVE_API_KEY",
  "tavilyApiKey": "$TAVILY_API_KEY",
  "exaApiKey": "$EXA_API_KEY",
  "maxInlineContentChars": 30000
}
```

Support `$ENV_VAR` interpolation for secrets. Load on `session_start`, make it reloadable via `/reload`.

### 3.3 Add `source_check` Tool

**Why:** pi-web-access has it. It's genuinely useful for verifying claims with citations.

**Minimal implementation:**
1. Run `web_search` with the claim as query + optional user queries.
2. Fetch top N pages.
3. Return a structured artifact: `{ status: "supported" | "contradicted" | "unclear", sources: [...], passages: [...] }`.

Register as a third tool alongside `web_search` and `web_fetch`.

### 3.4 GitHub URL Handling

When `web_fetch` sees a GitHub URL:
- `/owner/repo` → `git clone --depth 1`, return tree + README.
- `/owner/repo/blob/...` → fetch raw content via `raw.githubusercontent.com`.
- `/owner/repo/tree/...` → clone + return directory listing.

Cache clones per session; clean up on `session_shutdown`.

### 3.5 Batch Queries

Add `queries: string[]` parameter to `web_search` (alongside `query`). Run them in parallel against the selected provider(s). Deduplicate across queries using the existing `aggregate()`.

### 3.6 Fallback Chains for Fetch

When primary HTTP extraction fails (empty body, cookie wall), try:
1. Jina Reader (`https://r.jina.ai/<url>`) — free, handles JS rendering.
2. Return whatever came back with a warning.

Register Jina as an optional provider in the registry. No API key required.

### 3.7 Retry Transient Failures

Both `web_search` and `web_fetch` do zero retries. Add a simple retry wrapper:

```ts
async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 1000): Promise<T>
```

Apply to all outbound `fetch()` calls. Retry on 429, 502, 503, 504, and network errors.

---

## Phase 4 — Testing (Score: 5→9)

### 4.1 Coverage Targets

| Module Group | Current | Target | Strategy |
|-------------|:-------:|:------:|----------|
| Pure functions (aggregator, cache, selector, budget) | ✅ tested | maintain | Update stale assertions |
| Content pipeline (extractor, processor, section-parser) | ❌ none | ≥ 80% | Feed real HTML fixtures, assert sections/tokens/truncation |
| Providers (brave, tavily, exa) | ❌ none | ≥ 70% | Mock `fetch()`, test request construction + response parsing |
| Integration (tool execute → formatted output) | ❌ none | ≥ 3 scenarios | End-to-end with mock HTTP, assert tool output shape |
| `index.ts` / tool registration | ❌ none | smoke test | Verify tools register without throwing |

### 4.2 Test Fixtures

Create `tests/fixtures/`:
- `simple-article.html` — basic blog post with `<article>`, headings, code blocks.
- `api-docs.html` — large docs page with 50+ sections (tests section selection + spillover).
- `npm-package.html` — JSON-LD structured data, OpenGraph tags.
- `cookie-wall.html` — page that returns a cookie notice (tests fallback detection).
- `sample.pdf` — multi-page PDF for pdf-extractor tests.

### 4.3 CI

Add a GitHub Actions workflow (or local `npm run check` that runs in a git hook):
```yaml
- npm run typecheck
- npm run lint
- npm run test
```

Block merges on failure.

---

## Phase 5 — Distribution & Ecosystem (Score: 5→9)

### 5.1 Make It a Pi Package

✅ Partially done already: `web-search/package.json` already declares `"pi": {"extensions": ["./src/index.ts"]}`, so pi can load it locally today. What's actually missing is the rename, version bump, and npm publish — the manifest shape itself doesn't need inventing.

Update `web-search/package.json`:
```json
{
  "name": "bulliexplorer-web-search",
  "version": "0.4.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Publish to npm. Anyone can then: `pi install npm:bulliexplorer-web-search`.

### 5.2 Register Commands

Add interactive commands via `pi.registerCommand()`:
- `/websearch [queries]` — open inline search results with selection.
- `/search` — browse cached results from current session.

### 5.3 Register a Keyboard Shortcut

```ts
pi.registerShortcut("ctrl+shift+w", {
  description: "Toggle web search activity monitor",
  handler: async (_ctx) => { /* toggle status widget */ },
});
```

### 5.4 Activity Widget

Use `ctx.ui.setWidget()` to show live search/fetch activity:
```
─── Web Search ─────────────────────────
  🔍 "FastAPI async"     brave  200  1.2s ✓
  📄 docs.example.com    GET    200  0.8s ✓
────────────────────────────────────────
```

---

## Phase 6 — Advanced (Score: 9→10, "Awesome Shit")

### 6.1 SSRF Guard

Before any `fetch()`, validate the URL:
- Block `file://`, `data:`, `javascript:` schemes.
- DNS-resolve the hostname; block private/reserved IP ranges (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `::1`, link-local).
- Follow redirects manually; re-validate each hop.
- Cap response size (5 MB streamed).

pi-web-access does this thoroughly. We have zero protection beyond the `^https://` schema regex.

### 6.2 Domain Policy

```json
{
  "fetchContent": {
    "domainPolicy": {
      "allow": ["docs.example.com"],
      "deny": ["old.example.com"]
    }
  }
}
```

Check before every fetch. Deny wins on conflict.

### 6.3 `answer` Mode for `web_fetch`

Add `mode: "answer"` parameter. Instead of returning the full page markdown, run the extracted content through the session's active model with the user's `prompt` and return a grounded answer. Store the full content for `get_search_content` retrieval.

This is the single biggest UX differentiator pi-web-access added recently — the model reads the page for you and answers your specific question.

### 6.4 Stored Content Retrieval (`get_search_content` Tool)

Register a third/fourth tool that lets the model retrieve previously-fetched full content by `responseId`:
```ts
get_search_content({ responseId: "abc123", urlIndex: 0 })
get_search_content({ responseId: "abc123", findText: "installation" })
```

This replaces our spillover-to-filesystem approach with an in-memory content store that the model can query directly — no `read` tool call on a temp file needed.

### 6.5 Rate Limiting

Per-provider request budgets:
- Brave: 1 req/s (free tier).
- Tavily: default, no limit documented.
- Exa: respect Retry-After headers.
- All fetch: 3 concurrent, 30s timeout.

Use `p-limit` (already in pi-web-access's deps) or a simple semaphore.

### 6.6 RSC / Next.js Flight Data Parser

When HTML extraction yields an empty shell (common with Next.js SSR), parse the RSC flight data payload (`<script>self.__next_f.push(...)</script>`) to extract the real content. pi-web-access has `rsc-extract.ts` for this.

---

## Implementation Order

| Sprint | Work | Score Impact |
|--------|------|:------------:|
| **1** | 1.1–1.6 (foundation fixes) | 5→7.5 |
| **2** | 2.1–2.3 (pi integration) + 4.1–4.3 (tests) | 7.5→8.5 |
| **3** | 3.1–3.3 (Exa, config, source_check) + 5.1 (npm publish) | 8.5→9 |
| **4** | 3.4–3.7 (GitHub, batch, fallback, retry) + 5.2–5.4 (commands, widget) | 9→9.5 |
| **5** | 6.1–6.6 (SSRF, answer mode, stored content, RSC) | 9.5→10 |

---

## Files Touched (Projected)

```
src/
├── index.ts                 ← gut to ~80 LOC (factory only)
├── tool-search.ts           ← NEW: web_search tool
├── tool-fetch.ts            ← NEW: web_fetch tool  
├── tool-source-check.ts     ← NEW: source_check tool
├── tool-get-content.ts      ← NEW: get_search_content tool
├── format.ts                ← NEW: result formatting
├── section-selector.ts      ← NEW: shared section selection
├── config.ts                ← NEW: JSON config loader
├── ssrf.ts                  ← NEW: URL safety validation
├── retry.ts                 ← NEW: retry wrapper
├── content-store.ts         ← NEW: replaces spillover for model access
├── types.ts                 ← extend with config types
├── token-budget.ts          ← reduce to ratio math only (kill model table)
├── token-counter.ts         ← simplify (drop remote Anthropic, keep heuristic + tiktoken)
├── content-extractor.ts     ← unchanged
├── content-processor.ts     ← use shared section-selector
├── section-parser.ts        ← unchanged
├── structured-extractor.ts  ← unchanged
├── pdf-extractor.ts         ← use shared section-selector
├── spillover.ts             ← accept cwd param, deprecate for model (keep for user read)
├── keychain.ts              ← replace with config.ts, cross-platform
├── search-aggregator.ts     ← unchanged
├── search-cache.ts          ← unchanged
├── provider-selector.ts     ← extend for Exa
├── providers/
│   ├── base.ts              ← unchanged
│   ├── brave.ts             ← unchanged
│   ├── tavily.ts            ← unchanged
│   ├── exa.ts               ← NEW
│   ├── jina.ts              ← NEW (fetch fallback only)
│   ├── registry.ts          ← extend with fallback chain
│   └── index.ts             ← unchanged
├── github-extract.ts        ← NEW
└── rsc-extract.ts           ← NEW

tests/
├── fixtures/                ← NEW: HTML/PDF test fixtures
├── content-extractor.test.ts     ← NEW
├── content-processor.test.ts     ← NEW
├── providers/brave.test.ts       ← NEW
├── providers/tavily.test.ts      ← NEW
├── section-selector.test.ts      ← NEW
├── integration.test.ts           ← NEW
├── provider-selector.test.ts     ← update
├── search-aggregator.test.ts     ← unchanged
├── search-cache.test.ts          ← unchanged
├── structured-extractor.test.ts  ← unchanged
└── token-budget.test.ts          ← rewrite for ratio math
```

---

## Non-Goals

These are things pi-web-access does that we deliberately skip:

- **25+ search providers** — diminishing returns. Exa + Brave + Tavily covers 95% of use cases. Users who need SerpBase or Bright Data SERP should use pi-web-access.
- **YouTube/video understanding** — requires Gemini integration + ffmpeg + yt-dlp. Out of scope for a web search extension. Use pi-web-access or a dedicated video extension.
- **Browser cookie auth** — complex, platform-specific Chromium cookie decryption. Security surface too large.
- **Curator UI** — pi-web-access's browser-based search curation window is impressive but complex (ephemeral HTTP server + SSE + HTML generation). Our advantage is being lean; a `/websearch` command with inline TUI selection is sufficient.
- **OpenAI Responses API search** — tied to a specific provider's API. Our extension is provider-agnostic.

---

## Audit Addendum (Aug 22 2026)

Verified against the actual `web-search/` source, a live `npm test` run, and the current `pi-web-access` page/npm listing. The original 6.5/10 baseline and Phase 1–6 roadmap hold up well — most claims checked out exactly as written (335-LOC `index.ts`, ~26% test-file coverage, singleton `registry`, zero hits for retry/SSRF/`session_start`/CI). Six corrections folded in above:

- 2.2 overstated "ignores `ctx.model`" — `web_fetch` already reads it; the real gap is `ctx.getContextUsage()`.
- 2.3 overstated keychain "fails on Linux/Windows" — it degrades gracefully via the existing fallback chain.
- 1.5's duplicated `selectSections()` is a live correctness bug (missing rank-sort in the PDF copy), not just DRY debt — reprioritize as Major.
- 1.4's `process.cwd()` bug ships with a comment in the code that asserts the opposite of what it does.
- New: `package.json` (0.3.3) hasn't been bumped to match today's CHANGELOG entry (0.3.4) — cheap fix, roll into 1.2.
- 5.1 undersells existing progress — the pi package manifest already exists; only publish/rename is left.
- Benchmark numbers (version, downloads) were a few days stale — corrected above; the feature claims (4 tools, 25 providers, zero-config Exa, SSRF guard, `answer` mode, `get_search_content`, RSC parsing) all check out against the live `pi-web-access` README.

Unverified: the claim that the model table "went stale three times" (no git history included in the archive to check against).

---

## Phase 1 Completion Log (v0.3.5 — Aug 22 2026)

**Status:** All 6 items complete. `npm run check` green (typecheck + lint + 114 tests, 0 failures).

| Item | Status | Notes |
|------|:------:|-------|
| 1.1 | ✅ | `MODEL_CONFIGS`/`PROVIDER_FALLBACKS`/`detectProvider` deleted. `token-budget.ts` reduced to `buildBudget()` + `buildUnknownBudget()`. Provider normalised from `event.model.provider`. |
| 1.2 | ✅ | Old 22-test suite (model-name assertions) replaced with 19 tests on `buildBudget()` ratio math + provider normalisation. `package.json` bumped 0.3.3→0.3.5. |
| 1.3 | ✅ | `pi.on("session_start", ...)` resets `cache = new SearchCache()`. |
| 1.4 | ✅ | `CACHE_DIR` no longer captured at module load. `writeSpillover()` and `cleanExpiredSpillover()` accept `cwd?` param. Misleading comment removed. |
| 1.5 | ✅ | `section-selector.ts` extracted with rank-sort (from `content-processor.ts`). `pdf-extractor.ts` old copy (no rank-sort) deleted. 10 new tests in `section-selector.test.ts`. |
| 1.6 | ✅ | `index.ts` 335→69 LOC. New: `tool-search.ts`, `tool-fetch.ts`, `format.ts`. |

## Phase 2 Completion Log (v0.3.6 — Aug 22 2026)

**Status:** All 3 items complete. `npm run check` green (typecheck + lint + 120 tests, 0 failures).

| Item | Status | Notes |
|------|:------:|-------|
| 2.1 | ✅ | `AnthropicTokenCounter` deleted. `createTokenCounter()` no longer accepts `apiKey`. `index.ts` no longer imports `keychain.ts` or resolves the Anthropic key. Anthropic models use heuristic (3.5 chars/token). |
| 2.2 | ✅ | `tool-fetch.ts` calls `ctx.getContextUsage()` and reduces `maxContentTokens` via `effectiveContentBudget()`. 6 new tests. |
| 2.3 | ✅ | `keychain.ts`: macOS Keychain gated behind `process.platform === "darwin"`. Error message is platform-appropriate. `.env` lookup accepts `cwd` param. |

### Leftover / Deferred Items

| Item | Phase | What | Why deferred |
|------|:-----:|------|-------------|
| CI workflow (GitHub Actions) | 1.2 | Wire `npm test` into CI so failures block merge | No `.github/workflows/` in the repo yet; `npm run check` is the local equivalent. Add when CI infra is set up. |
| Singleton `ProviderRegistry` | 3+ | `registry.ts` exports a module-level singleton — not testable in isolation | Phase 3+ scope (provider design improvements). |
| `TokenCountMode` type cleanup | — | `"exact_remote"` variant is unused after 2.1 | Cosmetic; harmless to keep in the union type. |
| `ctx.modelRegistry.getProviderAuth()` for provider keys | 3+ | Use pi auth system for Brave/Tavily keys instead of `keychain.ts` | Requires understanding which providers pi manages vs extension-specific keys. Phase 3+ scope. |