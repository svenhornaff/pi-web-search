# Changelog

## [0.5.1] — 2026-08-24

### Changed

- **Widget is now permanently visible**: removed the `Ctrl+Shift+W` toggle
  shortcut and the `widgetVisible` flag. `renderSearchWidget()` always renders;
  the widget appears on `session_start` and refreshes after every search with
  the current cache count. Updated README accordingly.

### Removed

- `Ctrl+Shift+W` shortcut — widget is always on, no toggle needed.

---

## [0.5.0] — 2026-08-22

> Rerating audit (`docs/development/refactor_v3.md`) found five regressions in
> the previous two releases, three of them CI-catchable. This release fixes
> all five and adds the CI gate so the same bugs can't recur silently.

### Added

- **CI: version-consistency gate**: `scripts/check-version.mjs` fails the
  build if `package.json`'s version and `CHANGELOG.md`'s top entry drift
  apart, wired into `pi-web-search-check.yml` as its own step (before
  typecheck/lint/test) and into `npm run check` locally. This exact bug class
  recurred twice (0.3.4/0.3.3, then 0.4.1/0.4.0) without a human catching it
  either time — this is a CI problem, not a diligence problem.
- **`src/safe-fetch.ts`**: hardened fetch for arbitrary URLs, used by
  `web_fetch` and `BraveProvider.fetch()`. Replaces `redirect: "follow"` +
  post-hoc `response.url` validation (the blocked hop's request had already
  fired by then) with `redirect: "manual"` and per-hop `validateFetchUrl()`,
  so a redirect into a private/loopback target is rejected before that hop
  ever reaches the network. Also enforces a 5 MB response cap — via
  `Content-Length` when present, and by aborting the stream mid-read
  otherwise, since a server can omit or lie about `Content-Length`.

### Fixed

- **Retry logic could not retry the errors it claimed to (F-5)**: the old
  `withRetry(() => fetch(...))` only ever saw thrown errors — `fetch()`
  resolves (doesn't throw) on HTTP 429/502/503/504, so the substring matches
  for those statuses in `defaultShouldRetry` were dead code for every
  provider request. Replaced with `fetchWithRetry()` (`src/retry.ts`), which
  inspects `response.status` inside the loop and retries 429/502/503/504
  in-loop, honoring `Retry-After` on 429 (seconds or HTTP-date) instead of
  the flat backoff. `web_fetch` now actually retries too, via `safeFetch()` —
  previously it had no retry at all despite the 0.4.1 changelog entry saying
  otherwise (see the correction below).
- **New provider tests shipped failing on any keyless machine (F-6)**:
  `providers.test.ts` stubbed `globalThis.fetch` but `search()` still called
  `resolveApiKey()` first (Keychain → env → `.env`), which the stub never
  touched. It only passed because the author's machine happened to have real
  keys set. `BraveProvider` and `TavilyProvider` now take an optional
  `apiKey` constructor argument that skips resolution entirely when
  supplied; the tests inject a fake key directly instead of relying on
  environment state.
- **`/websearch` bypassed the session cache (F-9)**: the command called the
  provider directly, so a `/websearch foo` followed by the model searching
  `foo` (or vice versa) paid for the same query twice. It now shares the
  same cache key/lookup as the `web_search` tool.
- **CHANGELOG had a duplicate entry and a false claim (F-4/F-7)**: the
  "Session cache reset" fix was listed verbatim under both 0.3.7 and 0.4.0 —
  it only happened once, in 0.3.7; removed from 0.4.0. The 0.4.1 entry's
  claim of `web_fetch` retry support was false at the time (see corrected
  entry below) — that gap is what this release actually closes.

### Documentation

- **README**: documented the DNS-rebinding TOCTOU gap as a known limitation
  (F-8c) — `validateFetchUrl()` resolves the hostname, then `fetch()`
  resolves it again independently, so a DNS answer that changes between the
  two lookups isn't caught. A full fix needs resolved-IP pinning (a custom
  undici `Agent`); out of scope while the guard already blocks every
  non-rebinding SSRF path.

---

## [0.4.1] — 2026-08-22

### Added

- **Phase 6 — fetch hardening**: Added SSRF checks that block non-HTTPS and
  private/loopback targets before outbound fetches, plus retry logic for
  transient network errors in provider searches.

  > **Correction (0.5.0):** the retry logic described here only ever retried
  > transport-level failures (ECONNRESET, timeouts) — `fetch()` resolves
  > rather than throws on HTTP 429/5xx, so those statuses were never
  > actually retried, and `web_fetch` had no retry path at all despite being
  > named above. See [0.5.0](#050--2026-08-22) for the real fix.

## [0.4.0] — 2026-08-22

### Added

- **Phase 5 — package + command UX**: package renamed to `web-search`, registered user-facing commands (`/websearch`, `/websearch-cache`), and hooked a `Ctrl+Shift+W` shortcut plus status widget to surface the extension's live state.

## [0.3.7] — 2026-08-22

### Added

- **Phase 4 — test coverage and CI**: Added fixture-driven content-pipeline coverage for HTML extraction and a provider mock suite for Brave + Tavily. Added a GitHub Actions workflow to enforce `npm run typecheck`, `npm run lint`, and `npm run test` on extension changes.

### Fixed

- **Session cache reset**: `SearchCache` now supports a real `clear()` reset, and the `web_search` tool resolves the current cache instance at execute time so a `/resume`d session does not leak stale cached results from the previous one.

## [0.3.6] — 2026-08-22

### Changed

- **2.1 `token-counter.ts` — removed remote Anthropic token counting**: Deleted
  `AnthropicTokenCounter` class, which made a network call to the Anthropic
  `count_tokens` API on every `web_fetch`. The accuracy gain over the heuristic
  counter (~3.5 chars/token) is marginal for section-selection budgeting and the
  call cost latency on every fetch. Anthropic models now use the same heuristic
  as Google models. The `ANTHROPIC_API_KEY` is no longer needed by the extension
  for token counting (still needed by pi itself for model auth). If exact
  Anthropic counting is ever needed, use `ctx.modelRegistry.getProviderAuth()`
  instead of managing a separate key.

- **2.2 `tool-fetch.ts` — dynamic content budget via `ctx.getContextUsage()`**:
  `web_fetch` now checks how much context the current session has already
  consumed before deciding how much content to return. Previously a 1M-context
  model always got ~780K of content budget regardless of whether the session had
  already consumed 900K of context. The effective budget is now
  `min(staticBudget, contextWindow − usedTokens − outputReserve)`, preventing
  context overflow on long sessions.

### Fixed

- **2.3 `keychain.ts` — cross-platform**: macOS Keychain lookup is now gated
  behind `process.platform === "darwin"`. On Linux/Windows the doomed
  `/usr/bin/security` syscall is skipped entirely instead of being attempted and
  caught. The error message shown when no key is found no longer recommends
  "Option 1 — macOS Keychain" on non-macOS platforms. `.env` file lookup now
  accepts an explicit `cwd` parameter (same fix as spillover in 0.3.5).

---

## [0.3.5] — 2026-08-22

### Changed

- **1.1 `token-budget.ts` — removed hardcoded model table**: Deleted `MODEL_CONFIGS`,
  `PROVIDER_FALLBACKS`, and `detectProvider()`. Token budget is now computed from the
  `model_select` event payload (`event.model.contextWindow`, `event.model.maxTokens`,
  `event.model.provider`). The module is reduced to a pure `buildBudget()` function that
  does ratio math plus a `buildUnknownBudget()` fallback for pre-`model_select` state.
  No model names appear in the code — the platform is the source of truth.

- **1.6 `index.ts` — split into four files**: The 335-LOC god-file is now:
  - `tool-search.ts` — `web_search` tool definition + execute
  - `tool-fetch.ts` — `web_fetch` tool definition + execute
  - `format.ts` — `formatSearchResults()`, `buildFetchResponse()`
  - `index.ts` — extension factory only (69 LOC): model tracking, cache lifecycle, tool registration

### Fixed

- **1.2 Stale `gpt-5` test**: The 0.3.4 CHANGELOG added `gpt-5` to `MODEL_CONFIGS` (400K
  context) but the test still asserted the old provider-fallback value (128K). The test now
  exercises `buildBudget()` ratio math only — no model names to go stale. `package.json`
  bumped from 0.3.3 → 0.3.5 (was lagging behind the 0.3.4 CHANGELOG entry).

- **1.3 Search cache leaked across sessions**: `SearchCache` was created once at extension
  load and never reset. A `/resume`'d session would see stale results from the previous
  session. Added `pi.on("session_start", () => { cache = new SearchCache(); })`.

- **1.4 `spillover.ts` — `process.cwd()` captured at module load**: `CACHE_DIR` was resolved
  once when the module first loaded. If pi changed cwd (e.g. `/resume` to a different
  project), spillover files wrote to the wrong directory. Fixed: `writeSpillover()` and
  `cleanExpiredSpillover()` now accept an explicit `cwd` parameter (from `ctx.cwd`).
  Also fixed the inline comment which read *"Resolved once at module load — safe regardless
  of process.cwd() at call time"* — the opposite of what the code did.

- **1.5 `selectSections()` — silent rank-sort bug in PDF path**: `pdf-extractor.ts` had its
  own `selectSections()` copy that was missing the rank-sort step (sections were selected in
  document order instead of by importance). Today this was masked because PDF page ranks
  happen to follow document order, but it would silently break the moment ranking became
  content-aware. Extracted the shared implementation into `section-selector.ts` with the
  rank-sort from `content-processor.ts` as the source of truth. Both consumers now use it.

---

## [0.3.4] — 2026-08-22

### Fixed

- **`token-budget.ts` — missing current models**: Added `claude-opus-5` (1M context, 128K output;
  released in pi 0.82.1), `gpt-5` (400K context), and `gpt-5.5` (1.05M context) to `MODEL_CONFIGS`.
  These models previously fell through to the `"unknown"` provider fallback (100K context cap),
  causing `web_fetch` to return far less content than the models can actually handle.

- **`token-budget.ts` — `detectProvider` too narrow**: Extended provider detection to map
  `deepseek`, `kimi`, and `glm` model names to the `"openai"` provider bucket (128K fallback)
  instead of `"unknown"` (100K). These are the models in the active `enabledModels` list that
  were silently getting the most conservative budget.

- **`package.json` — unused `@anthropic-ai/sdk` dependency**: Removed from `dependencies`.
  The SDK is never imported anywhere; token counting uses direct `fetch()` against the
  Anthropic REST API. This eliminates ~2 MB of unused runtime code installed with the extension.

---

## [0.3.3] — 2026-05-11

### Added

- **Tests** (`tests/`): 105 tests across 20 suites covering the five pure-function modules
  identified in the code review. Zero new dependencies — uses Node 26's built-in
  `node:test` runner with `--experimental-strip-types` for native TypeScript execution.

  | File | Suites | Tests |
  |------|--------|-------|
  | `search-aggregator.test.ts` | 4 | 16 |
  | `provider-selector.test.ts` | 5 | 36 |
  | `search-cache.test.ts` | 3 | 14 |
  | `structured-extractor.test.ts` | 4 | 26 |
  | `token-budget.test.ts` | 4 | 22 |

  `npm run test` added to scripts; `npm run check` now runs typecheck + lint + test.

### Fixed

- **`structured-extractor.ts` — stateful regex `lastIndex` leak**: `JSON_LD_RE` has the
  `/g` flag and is module-level. When `extractJsonLd` returned early on a successful
  match, `lastIndex` was not reset, causing every alternating call on the same HTML
  string to return `null`. Added `JSON_LD_RE.lastIndex = 0` on every return path.
  Discovered by the new test suite.

---

## [0.3.2] — 2026-05-11

### Fixed

- **User-Agent inconsistency** (`providers/brave.ts:124`): `PiBraveSearch/0.2` → `pi-web-search/0.3`
  to match `index.ts`. This is the User-Agent sent on every `web_fetch` HTML request.

- **`MAX_FULL_CONTENT_CHARS` magic number** (`index.ts`): extracted `30_000` into a named
  constant with a comment (`~8k tokens ≈ 30k chars`). Both usages now reference the constant.

- **URL validation in `web_fetch`** (`index.ts`): added `pattern: "^https://"` to the TypeBox
  schema for the `url` parameter. Requests to `file://`, `data:`, or other non-HTTPS schemes
  are now rejected at the schema layer before `fetch()` is called.

- **O(n²) section merge** (`content-processor.ts`): replaced `sections.map(s => selected.find(...))`
  with a `Map<id, Section>` pre-built before the loop. Lookup is now O(1) per section — O(n)
  total instead of O(n²). Negligible at typical page sizes; material for large API reference
  pages split into 200+ sections.

---

## [0.3.1] — 2026-05-11

### Fixed

- **Model tracking** (`src/index.ts`): Removed hardcoded `"claude-opus-4.7"` fallback. The
  active model is now tracked via the `model_select` event (fires with `source: "restore"` at
  session startup, before any tool call). Inside `web_fetch`, `ctx.model?.id` is used as the
  live value; the closure is the belt-and-suspenders fallback; `"unknown"` routes to the
  conservative budget rather than silently impersonating a 1M-context Claude model.

- **Spillover cleanup** (`src/index.ts`, `src/spillover.ts`): `cleanExpiredSpillover()` was
  defined but never called — cache files accumulated indefinitely. Now called fire-and-forget
  at the start of every `web_fetch` execution.

- **Tavily `fetch()` removed** (`src/providers/tavily.ts`): The `site:` search hack used a
  full Tavily search API call (1 credit) per `web_fetch` invocation, returned unreliable
  results, and was unreachable anyway (the call site always resolves the Brave provider for
  fetching). Removed entirely. `web_fetch` uses a plain HTTP GET for all providers, at zero
  API cost. Tavily's full-content advantage is already delivered via `raw_content` embedded
  in `web_search` results.

- **Tavily `fullContent` surfaced** (`src/index.ts`): `raw_content` from Tavily search results
  was being captured in `SearchResult.fullContent` but silently discarded in
  `formatSearchResults` — the LLM never saw it. Now rendered inline under each result so
  the model can read the full page directly from `web_search` output without a follow-up
  `web_fetch` call. This was the core Tavily value proposition that was not being delivered.

- **Dead code removed** (`src/brave-client.ts`): 151-line original v0.1.0 client, fully
  replaced by `src/providers/brave.ts` since v0.3.0, never imported. Deleted.

### Documentation

- Removed stale phase-tracking documents (`PHASE2-IMPLEMENTATION.md`, `PHASE3-PREVIEW.md`,
  `MIGRATION.md`, `QUICK-START.md`, `SETUP.md`). All consolidated into `README.md`.
- `README.md` rewritten to reflect the actual implementation with no forward-looking TODOs.
- `providers/base.ts`: `fetch?()` contract clarified — providers whose content advantage is
  in search results (Tavily) should not implement it.
- `docs/web-search-extension-roadmap.md` added — forward-looking, unimplemented improvements only.

---

## [0.3.0] — 2026-05-11

### Added — Phase 2: Multi-Provider Search

- Dual-provider architecture: Brave (contextual) + Tavily (keyword / deep research)
- `src/providers/` layer: `base.ts`, `brave.ts`, `tavily.ts`, `registry.ts`, `index.ts`
- `web_search` parameters: `provider`, `freshness` (Brave), `depth` (Tavily)
- Tavily: `include_raw_content: true` — full page content in search results
- Tavily: `include_answer: true` — AI summary prepended to first result
- Keychain module: three-tier resolution (Keychain → env var → workspace `.env`)

---

## [0.2.0] — 2026-05-11

### Added — Phase 1: Provider-Aware Token Budgeting

- `src/token-budget.ts`: per-model context window and safe content limits
- `src/token-counter.ts`: Anthropic `count_tokens` API / `js-tiktoken` / heuristic fallback
- `src/content-extractor.ts`: HTML → markdown via linkedom + Turndown + GFM plugin
- `src/section-parser.ts`: heading-based section splitting, keyword + code + table ranking
- `src/content-processor.ts`: greedy section selection within token budget
- `src/spillover.ts`: full content written to `.pi/cache/web-fetch/` with 24-hour TTL

---

## [0.1.0] — Initial release

- `web_search` via Brave Search API
- `web_fetch` with basic regex-based HTML stripping
- macOS Keychain integration
- Abort signal support
