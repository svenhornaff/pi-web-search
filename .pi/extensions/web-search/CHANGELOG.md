# Changelog

## [1.5.0] — 2026-08-24

### Changed

- **Phase A — Exa: `highlights` replaces `text` as primary content field**:
  `exa.ts` now requests `highlights: { numSentences: 5, highlightsPerUrl: 3 }`
  alongside `text: { maxCharacters: 2000 }` in the same `contents` call (both
  fields are supported in one request per Exa docs). `fullContent` is built
  from highlights when present (joined with ` … `), falling back to `text`
  when the result has no highlights. `description` uses the same priority chain.
  Per Exa's own agent-workflow guidance: highlights return the most relevant
  excerpts at ~10x fewer tokens than raw text — directly serves the extension's
  token-budget differentiator.

- **Phase A — Exa: auth migrated to `Authorization: Bearer`**:
  The header was `x-api-key`; Exa's primary documented pattern (Aug 2026) is
  `Authorization: Bearer $EXA_API_KEY`. Migrated. `x-api-key` is noted as a
  rollback comment in the source.

- **Phase B — Brave: LLM Context endpoint**:
  `BRAVE_SEARCH_URL` updated from `/res/v1/web/search` to `/res/v1/llm/context`
  — Brave's documented "most powerful Search API for AI", shaped for machine
  consumption. Same `X-Subscription-Token` auth header. Response parser handles
  both the new flat `results` shape and the legacy `web.results` shape as a
  graceful fallback for older subscription tiers. `snippet` field preferred over
  `description` when present.

- **Phase C — content-fetch fallback diversification**:
  `content-processor.ts` now tries Tavily `/extract` before Jina Reader when
  standard extraction and RSC parsing yield sparse content (< 50 estimated
  tokens). Tavily Extract reuses the existing `TAVILY_API_KEY` — no new
  credential surface. Jina Reader remains the final fallback (zero-key entry
  point). Fallback chain: RSC parser → Tavily Extract → Jina Reader.

- **Phase C — `JINA_API_KEY` support added to `keychain.ts`**:
  Optional key resolves via the same Keychain/env/`.env` chain as the other
  three providers (service `"jina-api-key"`, env var `JINA_API_KEY`). When
  set, Jina Reader calls include `Authorization: Bearer` for the higher
  authenticated rate tier. When absent, the existing unauthenticated free-tier
  behaviour is preserved.

- **Phase D — default `fallbackOrder` changed to `["brave", "exa", "tavily"]`**:
  Previous default was `["exa", "brave", "tavily"]`. Updated per AIMultiple 2026
  agentic-search benchmark: Brave scored highest on general-purpose queries;
  Exa remains second for its semantic strengths; Tavily last. Category-based
  primary selection in `provider-selector.ts` is unchanged — this only affects
  which provider is tried first when the primary fails.

- **Phase E — Tavily: `api_key` moved from request body to `Authorization: Bearer` header**:
  Body-embedded credentials are more likely to surface in proxy logs than
  header-embedded ones. Migrated to `Authorization: Bearer $TAVILY_API_KEY`
  to match current Tavily integration examples.

- **Jina User-Agent version string updated**: `pi-web-search/0.8` → `pi-web-search/1.5`.

### Added

- **Tests for auth and highlights changes (Phases A, B, E)**:
  - `exa.test.ts`: `Authorization: Bearer` header assertion replaces `x-api-key`
    assertion; two new tests — `requests highlights and text in the same contents
    call`, `falls back to text as fullContent when no highlights`; existing
    `exposes text as fullContent` test renamed and updated to assert highlights.
  - `providers.test.ts`: Tavily test now asserts `Authorization` header is
    present and `api_key` field is absent from the request body.

---

## [1.4.0] — 2026-08-24

### Fixed

- **4.4 — PDF `fullMarkdown` (completing Phase 2.1 for PDF path)**: `extractPDF()`
  in `pdf-extractor.ts` now sets `fullMarkdown: rawText` on the returned
  `ExtractedContent` when `selected.truncated` is true. Previously only
  `processContent()` (HTML path) set this field; `maybeStoreHandle()` fell
  back to `mainContent` for PDFs, so `get_fetch_content` returned truncated
  text for PDFs just as it did for HTML before Phase 2.1.

- **5.1 — README `maxInlineContentChars` description corrected**: the previous
  description said "Max characters returned inline by `web_fetch` before
  spillover" — which was wrong. The field controls the per-result `fullContent`
  char cap in `web_search` output (via `format.ts`). Updated to: "Max characters
  of `fullContent` included inline per `web_search` result (Exa/Tavily). Does
  not affect `web_fetch`."

### Added

- **7 new tests in `tests/config-runtime.test.ts`** (Phase 4.4 coverage):
  - `config.maxResults` propagates to provider API `count` param; explicit
    `max_results` param overrides it.
  - `config.maxInlineContentChars` truncates long `fullContent` in search
    results; short content passes through verbatim.
  - `config.defaultProvider` sets registry default; `"auto"` leaves it
    unchanged.
  - `ExtractedContent.fullMarkdown` shape check (PDF path structural
    regression guard).
  - All tests inject keys into singleton registry — keyless-verified
    (`env -i HOME=/tmp`).

### Changed

- **CI workflow updated** (Phase 5.2 + 5.3):
  - `npm audit --audit-level=high` step added after dependency install—
    gates on new high/critical advisories.
  - `pull_request` trigger narrowed from `["**"]` to `["main", "develop"]`
    so PRs to main are checked by the required status check needed for
    branch protection.

---

## [1.3.0] — 2026-08-24

### Fixed

- **3.1 — SSRF: six missing special-use IP ranges added to `ssrf.ts`**:
  The hand-rolled block-lists in `isBlockedIpv4` and `isBlockedIpv6` were
  missing the following documented IANA/RFC ranges:

  | Range | Purpose |
  |---|---|
  | `192.0.2.0/24` | TEST-NET-1 (RFC 5737) |
  | `198.51.100.0/24` | TEST-NET-2 (RFC 5737) |
  | `224.0.0.0/4` | Multicast (RFC 5771) |
  | `240.0.0.0/4` | Reserved / broadcast |
  | `::` | IPv6 unspecified address |
  | `ff00::/8` | IPv6 multicast |

  Also fixed a pre-existing bug: `url.hostname` from the Web URL API wraps
  IPv6 literals in brackets (`[::1]`), which `isIP()` doesn’t recognise as
  an IP address (returns 0), so IPv6 literals fell through to DNS lookup and
  raised `ENOTFOUND` instead of `Blocked network target`. Fixed by stripping
  the brackets before calling `isIP()`.

- **3.2 — GitHub handler: two `response.json()` calls replaced with bounded reader**:
  `fetchTreeListing` and `fetchRepoRoot` in `github-handler.ts` called
  `response.json()` directly on `safeFetch()` responses, bypassing the 5 MB
  cap entirely. Fixed: both now call `readBoundedText()` first and
  `JSON.parse()` after — the same pattern used for README fetches in the same
  file.

- **3.3 — Domain policy: trailing-dot normalization in `matchesDomainEntry()`**:
  A hostname with a trailing dot (a valid FQDN: `"docs.example.com."`) did
  not match a policy entry written without one (`"docs.example.com"`) and
  vice versa. Fixed: both `hostname` (in `checkDomainPolicy`) and `entry`
  (in `matchesDomainEntry`) have trailing dots stripped before comparison.

### Added

- **20 new tests in `tests/ssrf.test.ts`**:
  - 9 IPv4 range tests (6 new ranges + 3 regression guards)
  - 6 IPv6 range tests (3 new + 3 regression guards)
  - 5 trailing-dot normalization tests
  - All verified keyless (`env -i HOME=/tmp`).

---

## [1.2.0] — 2026-08-24

### Fixed

- **2.1 — `get_fetch_content` now stores full pre-truncation content**:
  Previously `tool-fetch.ts` stored `extracted.mainContent` (the already
  budget-truncated text) in `ContentStore`, so `get_fetch_content` handed
  back the same truncated text a second time. Fix:
  - `ExtractedContent` gains `fullMarkdown?: string` — set by
    `processContent()` when `selected.truncated` is true, holding the
    complete pre-selection markdown.
  - `maybeStoreHandle()` helper centralises handle creation and stores
    `fullMarkdown` (falling back to `mainContent` for PDF paths that
    don’t produce it yet).
  - Handle creation extended to PDF and GitHub-specialised response paths
    (was HTML-only). All three paths now call `maybeStoreHandle()`.

- **2.2 — Cache key now uses the actual answering provider after fallback**:
  When `searchWithFallback` fell back from Exa to Brave, the result was
  cached under Exa’s key — so the next cached hit incorrectly claimed Exa
  as the source. Fix: cache is keyed under `response.provider` (the actual
  answerer) after `searchWithFallback` returns, not under `primaryProvider`
  (the one that was asked first).

- **2.3 — Answer mode now actually changes section selection**:
  `applyAnswerMode()` previously only prepended a header; the prompt never
  reached `rankSections()`. Fix: `prompt` is threaded through
  `processContent()` → `rankSections()` as `promptHint`. Each word (3+
  chars) that appears in a section’s title (+20) or body (+10) boosts its
  rank, capped at +60, so answer-mode calls genuinely surface the most
  relevant sections rather than just relabelling the same output.

- **4.2 — Fallback test now tests real fallback**:
  The previous test called `execute()` with `provider: "brave"` (explicit,
  single-entry chain — no fallback) and contained its own admission it
  proved nothing. Replaced with two tests using an isolated `ProviderRegistry`
  with a keyless Exa that throws, asserting:
  (1) `searchWithFallback` moves to Brave and `response.provider === "brave"`;
  (2) the cache entry is keyed under `"brave"`, not `"exa"` (regression test
  for the 2.2 fix).

- **4.3 — Fallback tests use isolated registry**:
  The new fallback tests construct their own `new ProviderRegistry()` rather
  than mutating the shared singleton, matching the isolation pattern already
  used in `registry.test.ts`.

### Changed

- `rankSections()` in `section-parser.ts` accepts optional `promptHint?:
  string`. When provided, words from the hint boost matching sections’ rank.
  Backward-compatible — no call-sites changed except through
  `processContent()`.
- `processContent()` accepts optional `promptHint?: string`, passed to
  `rankSections()`. Backward-compatible — all existing call-sites unchanged.

---

## [1.1.0] — 2026-08-24

### Fixed

- **Missing `dependencies` in `package.json` (Phase 1.1)**: the extension
  declared zero runtime dependencies despite `src/` importing six packages
  (`linkedom`, `turndown`, `turndown-plugin-gfm`, `pdf-parse`, `js-tiktoken`,
  `@sinclair/typebox`). These existed only in the parent workspace, making the
  published artifact uninstallable in isolation. All six are now in
  `"dependencies"` with the same version ranges as the workspace parent.
  `@earendil-works/pi-coding-agent` moved to `"peerDependencies"` (pi provides
  it at runtime; consumers shouldn’t need to install it themselves).

### Added

- **Pack + smoke-install CI step (Phase 1.2)**: `.github/workflows/pi-web-search-check.yml`
  now runs `npm pack` then installs the tarball into a throwaway directory and
  smoke-imports the package. This catches missing-dependency regressions before
  they reach the registry — the same check that would have caught this bug.

### Changed

- **Stale provider copy updated (Phase 1.3)**:
  - `src/index.ts` header: "Dual-provider" → "Multi-provider"; updated tool
    list to include `get_fetch_content`; setup note now lists all three API keys.
  - Root `README.md` description: "dual-provider" → "multi-provider"; names
    all three providers and all three tools.
  - `package.json` `"description"`: "Brave + Tavily" → "Exa, Brave, Tavily".

---

## [1.0.2] — 2026-08-24

### Fixed

- **`tool-search.test.ts` key-injection bug (CI-breaking regression)**: the
  integration tests used the module-level singleton `registry` whose providers
  were constructed with no injected API key (`new BraveProvider()`, etc.).
  `stubFetch` overrides `globalThis.fetch` but key resolution shells out to
  `/usr/bin/security` (macOS Keychain via `execFile`) — not `fetch` — so stub
  never intercepted it. Tests passed locally only because the author’s machine
  has a real `brave-api-key` Keychain entry. On any keyless CI runner (Ubuntu,
  clean `HOME`) all 9 tests in the file failed with:
  `Error: Brave Search API key not found.` (confirmed by reproducing with
  `env -i HOME=/tmp/ci-home-test node ...`).

  **Fix:** re-register the singleton’s providers with injected test keys
  (`new BraveProvider("test-brave-key")`, etc.) at the top of the test file,
  using the same `registry.register()` method that `registry.test.ts` uses
  with isolated instances. This is the established project pattern; applying
  it to the singleton makes the integration tests genuinely keyless-safe
  without changing any production code.

  This is the same bug class as the old F-6 finding that was fixed in 0.3.7
  (`providers.test.ts` injected keys) — it recurred because the new
  `tool-search.test.ts` file didn’t follow the same pattern.

---

## [1.0.1] — 2026-08-24

### Fixed

- **Dead config fields wired** (`defaultProvider`, `maxResults`,
  `maxInlineContentChars`): all three were validated in `config.ts` and
  documented in the README but never applied to any call-site. Now:
  - `defaultProvider`: applied to `registry.setDefaultProvider()` on each
    `execute()` call when set to a non-`"auto"` value, so the config actually
    controls which provider is used when the model omits one.
  - `maxResults`: used as the per-call default (`params.max_results ?? configMaxResults`)
    in both the single-provider and batch paths of `tool-search.ts`.
  - `maxInlineContentChars`: threaded into every `formatSearchResults()` call
    as the third argument (was hardcoded at 30\,000 in `format.ts`). The
    constant `MAX_FULL_CONTENT_CHARS` is now `DEFAULT_MAX_FULL_CONTENT_CHARS`
    and is used only when no config value is provided.

### Added

- **`tests/surface.test.ts`**: asserts the exact registered tool/command/shortcut
  set produced by the extension factory. Turns the "public surface vs docs drift"
  class of regression (previously hit with the `Ctrl+Shift+W` shortcut) into a CI
  failure. 3 tests. Per-AGENTS.md: update this file alongside any surface change.

### Infra

- Created `main` branch from `develop` and pushed to GitHub. GitHub can now
  enforce branch protection on `main`; `develop` remains the working branch.

---

## [1.0.0] — 2026-08-24

### Added

- **7.1 — `answer` mode for `web_fetch`**: new optional params `mode: "answer"`
  and `prompt`. When set, extracted content is reframed with a relevance header
  citing the question. Section ranking already surfaces the most relevant
  content; answer mode adds the framing without a second LLM call. Exposed in
  the tool schema; `details.answerMode: true` and `details.prompt` set.

- **7.2 — `get_fetch_content` tool + `ContentStore`**: third LLM-callable tool
  that retrieves previously-fetched full page content by session handle. When
  `web_fetch` truncates a response, it stores the full markdown in `ContentStore`
  and includes `details.handle` in its response. The model calls
  `get_fetch_content({ handle })` to retrieve specific content without a second
  network round-trip. Supports `findText` (window around search term) and
  `sectionIndex` filtering. 30-minute TTL, cleared on `session_start`.

- **7.3 — Rate limiting (`src/rate-limiter.ts`)**: token-bucket rate limiter
  wired into `ProviderRegistry.searchWithFallback()` and `searchAll()`. Defaults:
  Brave 1 req/s, Tavily 5 req/s, Exa 5 req/s. Each provider has an independent
  limiter; parallel multi-provider calls are limited independently.
  `setRateLimit()` method added to `ProviderRegistry` for test overrides.

- **7.4 — Domain policy**: `domainPolicy: { allow, deny }` added to
  `WebSearchConfig`. `checkDomainPolicy()` added to `ssrf.ts` — checked in
  `tool-fetch.ts` before every `safeFetch()` call. Deny wins on conflict. Suffix
  matching: `"example.com"` in allow/deny matches `foo.example.com`. Empty
  allow list = allow all (opt-in restriction).

- **7.5 — RSC/Next.js flight-data parser (`src/rsc-parser.ts`)**: before
  falling back to Jina Reader, `content-processor.ts` now attempts to extract
  readable text from Next.js RSC flight data (`self.__next_f.push(...)` inline
  scripts). Avoids a second network round-trip for Next.js App Router pages that
  ship content in RSC format rather than plain HTML. Returns null when no
  flight data is found or extracted text is too short.

- **33 new tests** across 4 new test files:
  - `tests/rate-limiter.test.ts` — 4 tests (timing, queue order, high-rps)
  - `tests/domain-policy.test.ts` — 14 tests (empty policy, allow list,
    deny list, conflict resolution, case-insensitivity)
  - `tests/content-store.test.ts` — 8 tests (store/get/clear/list/evict/handles)
  - `tests/rsc-parser.test.ts` — 7 tests (no RSC data, short content, text
    extraction, type-0 skip, multiple scripts, internal filtering)

### Changed

- **`ProviderRegistry`**: `limiters` map added; `register()` creates a limiter
  for each provider; `searchWithFallback()` and `searchAll()` await the limiter
  before each provider call; `setRateLimit()` method added for test overrides.
- **`WebSearchConfig`**: `domainPolicy` field added (default: `{ allow: [], deny: [] }`).
- **`tool-fetch.ts`**: `getConfig` getter threaded through for domain policy;
  `getStore` getter added for `ContentStore` integration; answer mode applied
  at all three return paths (PDF, GitHub, HTML).
- **`content-processor.ts`**: RSC parser runs before Jina fallback (step 1b
  becomes RSC, step 1c becomes Jina).
- **`tool-search.test.ts`**: rate limits overridden to 1000 req/s on the
  singleton registry to keep integration tests fast.

---

## [0.9.0] — 2026-08-24

### Added

- **4.5 — GitHub URL handling (`src/github-handler.ts`)**: `web_fetch` now
  detects GitHub URLs before generic HTML extraction and routes them optimally:
  - `/owner/repo/blob/ref/path` → `raw.githubusercontent.com` direct fetch;
    non-markdown files wrapped in a language-appropriate code fence.
  - `/owner/repo/tree/ref/path` → GitHub API directory listing as a markdown
    table.
  - `/owner/repo` (repo root) → GitHub API README + top-level file tree,
    fetched in parallel.
  - Falls back to generic HTML extraction if the GitHub handler returns null
    (auth-required repos, rate limits, unexpected errors).
  - Response `details` includes `githubStrategy` field for debugging.

- **4.6 — Batch queries (`queries[]` in `web_search`)**: `web_search` now
  accepts `queries: string[]` (2–5 queries) as an alternative to `query`. Runs
  all queries in parallel against the same provider, then deduplicates results
  with the existing `search-aggregator.ts`. Cache keyed on the joined query
  string. Response `details` includes `batch: true` and `queries[]`.

- **4.7 — JS-render fallback (Jina Reader)**: `content-processor.ts` now
  detects near-empty HTML extractions (< 50 estimated tokens) and falls back to
  `https://r.jina.ai/<url>`, which renders JS and bypasses cookie walls. No
  API key required. Only triggered when content is genuinely sparse.

- **Phase 5 — Integration tests**:
  - `tests/tool-search.test.ts` (9 tests): `execute()` end-to-end with mocked
    `fetch()`; asserts formatted output shape, `details` fields, cache hit/miss,
    batch mode, missing-query guard, fallback chain.
  - `tests/github-handler.test.ts` (13 tests): `matchGitHubUrl()` pattern
    matching; `fetchGitHub()` raw/tree/repo-root strategies with mocked fetch;
    error/fallback cases.

### Changed

- **`tool-search.ts`**: `query` parameter is now `Optional` (required when
  `queries[]` not provided; guarded at runtime). `SearchDetails` interface
  introduced to give `execute()` a stable return type across all code paths.
- **`content-processor.ts`**: `extractMarkdown` result destructured via
  intermediate variable to allow `let` on `markdown`/`excerpt` (Jina fallback
  may reassign them) while keeping `title` as `const`.

---

## [0.8.0] — 2026-08-24

### Added

- **`src/providers/exa.ts` — Exa Search provider**: Neural semantic search
  (`POST https://api.exa.ai/search`). Resolves `EXA_API_KEY` via Keychain/env/`.env`
  (same pattern as Brave/Tavily). Returns `fullContent` (Exa `text` field)
  alongside every result so the LLM can read page content without a separate
  `web_fetch` call. Supports `freshness` filtering via `startPublishedDate`.
  If no key is configured, `search()` throws and the fallback chain in
  `tool-search.ts` transparently moves to Brave or Tavily.
- **29 new tests in `tests/exa.test.ts`**: header/method validation, result
  mapping, summary vs text fallback, fullContent exposure, maxResults capping,
  freshness date math, HTTP error handling, malformed-result filtering, empty
  results.

### Changed

- **Exa registered first in `ProviderRegistry`**: default provider is now `"exa"`
  (was `"brave"`). Fallback order updated to `["exa", "brave", "tavily"]` in
  `config.ts` defaults. Zero impact on users without an Exa key — the fallback
  chain silently moves to Brave.
- **`provider-selector.ts` updated with Exa heuristics**: `suggestProvider()`
  now routes AI/research/conceptual queries to Exa first (neural search is a
  better fit), deep-research/comparison queries to Tavily, and time-sensitive
  queries to Brave. Default fallback remains Brave.
- **`tool-search.ts` schema expanded**: `provider` and `providers[]` parameters
  now include `"exa"` as a valid literal. `providers[]` `maxItems` raised from 2
  to 3 to allow all three providers in parallel.
- **`provider-selector.test.ts` updated**: removed queries that changed expected
  provider under the new heuristics; added Exa routing tests.
- **`config.test.ts` updated**: default `fallbackOrder` assertions updated to
  `["exa", "brave", "tavily"]`.

---

## [0.7.0] — 2026-08-24

### Added

- **`src/config.ts` — JSON config file loader** (`~/.pi/web-search.json` or
  `$PI_CODING_AGENT_DIR/web-search.json`). Supports `defaultProvider`,
  `fallbackOrder`, `maxResults`, `maxInlineContentChars`. All fields optional
  — missing fields fall back to built-in defaults. `$ENV_VAR` references in
  string values are interpolated from `process.env` at load time. Config is
  loaded on every `session_start` so edits take effect on `/reload` without
  restarting Pi. Malformed or missing file never throws — silently uses
  defaults.

- **Provider fallback chain — `ProviderRegistry.searchWithFallback()`**: tries
  providers in order, returning the first success. Previously
  `getProvider().search()` would propagate the error directly if a provider
  failed (missing key, 401, network error); now auto-selected calls
  transparently fall through to the next provider in `config.fallbackOrder`.
  Explicit `provider:` param still means no fallback (intentional choice).
  `ProviderRegistry` is now exported (was private class) to enable isolated
  unit tests.

- **24 new tests** across two new test files:
  - `tests/config.test.ts` — 17 tests covering defaults, valid overrides,
    invalid value rejection, malformed JSON, env-var interpolation.
  - `tests/registry.test.ts` — 7 tests covering `searchWithFallback` success,
    single-hop fallback, multi-hop fallback, all-fail error propagation, empty
    chain, and constructor state.

### Changed

- **`tool-search.ts` `execute()` signature aligned**: now accepts `_onUpdate`
  and `_ctx` parameters (matching the pi tool execute contract), ready for
  future config-dependent behaviour (batch queries, per-call config overrides).
- **`createSearchTool()` accepts optional `getConfig` getter**: threads
  live config into the tool execute path without breaking the existing
  no-config call sites (getter is optional, defaults to null).
- **`ProviderRegistry` exported**: previously a private class; now exported
  so tests can construct isolated instances without touching the singleton.

---

## [0.6.0] — 2026-08-24

### Changed

- **Package renamed to `@svenhornaff/web-search`** (scoped npm name). The
  unscoped name `web-search` is already taken on the npm registry by an
  unrelated package (URL-generator, v0.6.2). Scoped name is permanently
  squatting-proof. Updated `package.json`, extension README install
  instructions, and root README accordingly.
- **License corrected to `NCSAL`** in `package.json` (was `MIT`, conflicting
  with the root `LICENSE` file which has always been Non-Commercial
  Source-Available). Extension README updated with the correct license
  statement and link to root `LICENSE`.
- **`TokenCountMode` union cleaned up**: removed unused `"exact_remote"`
  variant left behind when the Anthropic remote counter was deleted in 0.3.6.
  No runtime change — the variant was never produced or consumed after that
  deletion.

### Added

- **`session_shutdown` hook**: `cleanExpiredSpillover(ctx.cwd)` is now called
  on session shutdown (fire-and-forget, never blocks). Spillover files in
  `.pi/cache/web-fetch/` previously relied on opportunistic cleanup during the
  next `web_fetch` call; now they are also cleaned at session end.

---

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
