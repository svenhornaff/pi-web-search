# web-search Extension — Rerating v2 (Aug 22 2026, post-Phase 1+2)

> Verified against source at v0.3.6: full test run, typecheck, lint, and line-by-line diff of every claimed fix.
> Benchmark: `pi-web-access` v0.24.0 (verified live on pi.dev, Aug 22).

## Rerating: 6.5 → **7.5/10**

| # | Criterion | Was | Now | Target | Status |
|---|-----------|:---:|:---:|:------:|--------|
| 1 | Architecture | 7 | 8 | 9 | index.ts 335→54 LOC, clean 4-file split — but one new closure bug (F-1) |
| 2 | Code Quality | 7 | 8.5 | 9 | Model table gone, remote token counting gone, cwd threaded — still no retry |
| 3 | Testing | 5 | 5.5 | 9 | 120/120 green, stale test fixed, section-selector covered — but still ~26% file coverage; Phase 4 (fixtures, providers, integration) not started |
| 4 | Pi API Usage | 7 | 9 | 10 | `event.model.*`, `ctx.cwd`, `ctx.getContextUsage()` all in use — best-in-class now; `session_shutdown` unused |
| 5 | Provider Design | 8 | 8 | 9 | Unchanged — still 2 providers, no zero-config, no fallback chain |
| 6 | Content Pipeline | 8 | 8.5 | 9 | Shared rank-sorted selectSections fixes the latent PDF bug — no JS-render/GitHub handling yet |
| 7 | Documentation | 7 | 8.5 | 9 | CHANGELOG is exemplary (numbered against the refactor plan); README updated in sync |
| 8 | Security | 7 | 7 | 9 | Unchanged — no SSRF guard, no rate limiting |
| 9 | Maintainability | 5 | 8.5 | 9 | Zero model names in code, version drift fixed (0.3.6 everywhere) — CI still absent |
| 10 | Feature Completeness | 6 | 6 | 9 | Unchanged — Phase 3 not started |
| 11 | Ecosystem Fit | 5 | 5.5 | 9 | pi manifest present; still unpublished, no config file, no commands |
| | **Overall** | **6.5** | **7.5** | **9+** | |

## Verified done (evidence, not changelog trust)

- **1.1** `MODEL_CONFIGS`/`PROVIDER_FALLBACKS`/`detectProvider` deleted; `buildBudget()` is pure ratio math fed by `event.model.{contextWindow,maxTokens,provider}`. Zero model names in src/. ✅
- **1.2** Stale `gpt-5` test replaced by ratio-math tests; `npm test` = **120 pass / 0 fail** (was 104/1). `package.json` 0.3.6 matches CHANGELOG. ✅
- **1.4** `spillover.ts` takes explicit `cwd` (from `ctx.cwd`); the backwards comment is gone. ✅
- **1.5** Shared `section-selector.ts` with the rank-sort as source of truth; both HTML and PDF paths import it; dedicated test file covers rank-ordering. The latent PDF bug is dead. ✅
- **1.6** `index.ts` = 54 LOC factory (CHANGELOG says 69 — it got leaner after writing; harmless). ✅
- **2.1** `AnthropicTokenCounter` deleted; no raw Anthropic API calls remain. ✅
- **2.2** `web_fetch` computes `effectiveContentBudget(staticBudget, ctx.getContextUsage()?.tokens)` — capped at the static budget, floor 0. Correct math, correct clamping. ✅
- **2.3** Keychain gated behind `process.platform === "darwin"`; error message no longer recommends Keychain on Linux/Windows; `.env` lookup takes `cwd`. ✅
- `tsc --noEmit` clean, `eslint` clean.

## New findings

**F-1 · Critical — the 1.3 session-cache fix doesn't work.** `index.ts` registers the search tool with `pi.registerTool(createSearchTool(cache))` — passing the cache **instance** — then `session_start` does `cache = new SearchCache()`, which rebinds the local variable but leaves the tool's closure holding the original instance. The reset is a no-op for the only consumer of the cache; stale results still leak across `/resume`'d sessions — the exact bug 1.3 claims to fix, now hidden behind a handler that looks right. The file even demonstrates the correct pattern three lines later: budget and counter are passed as getters (`() => budget`). Fix: pass `() => cache` to `createSearchTool` (or add `SearchCache.clear()` and call that instead of reassigning — `clear()` doesn't exist yet). Add a regression test that fires `session_start` and asserts the tool misses the cache. CHANGELOG 1.3 entry needs a correction note.

**F-2 · Minor** — `web_search`'s `execute` still doesn't receive `ctx`; fine today (search needs no budget/cwd), but batch queries (3.5) and a config file (3.2) will need it — worth aligning the signature when touching the file next.

**F-3 · Minor** — spillover files are still written under `<cwd>/.pi/cache/web-fetch` with a 24h TTL cleaned only opportunistically on fetch; `session_shutdown` remains unused. Cheap win: hook cleanup there.

**F-4 · Note** — test file coverage is unchanged at ~26% (6/23 files). Everything Phase 1 touched is tested; everything Phase 4 promised (content pipeline fixtures, provider mocks, integration, smoke) is still open. This is the biggest drag on the score.

## What's needed for 9+ (parity) — unchanged from the plan, in order

1. **F-1 fix** — one line + one test. Do this before anything else; it's a shipped-broken fix.
2. **Phase 4 tests + CI** (`5.5→9` on testing, unlocks safe iteration): HTML/PDF fixtures, provider mocks on `fetch()`, 3 integration scenarios, `npm run check` in a GitHub Action blocking merge.
3. **Phase 3 core**: Exa zero-config (MCP path) + `auto` fallback chain, JSON config file with `$ENV` interpolation, retry wrapper on all outbound fetches.
4. **SSRF guard** (6.1): scheme block, private-IP DNS check, manual redirect re-validation, 5 MB cap. The benchmark has this thoroughly; we have a `^https://` regex.
5. **Publish** (5.1): rename, `pi install npm:…`.

## What makes it *better* than the benchmark — the genius list

pi-web-access wins on breadth (25 providers, video, curator UI, 7.1 MB). Don't chase breadth — it's their moat and their weakness. Beat them on precision and leanness:

- **Context-aware budgeting is already a differentiator — advertise and extend it.** pi-web-access slices content by a static `maxInlineContentChars`; we size returned content to what the *session can actually still hold* (`getContextUsage()`-driven). Extension: degrade gracefully — when available context is tight, return section *summaries + titles* with a `get_search_content`-style handle instead of hard truncation. Nobody in the ecosystem does budget-aware progressive disclosure.
- **Rank-based section selection is structurally smarter than char-slicing.** Their `fetch_content` returns the first N chars; we return the *most important* sections within budget. Extend with query-aware ranking: pass the search query into `web_fetch`, boost sections matching it (BM25-lite over section text — ~40 LOC, no deps). That turns fetch into retrieval, not download.
- **In-memory content store keyed for the model** (6.4) instead of their disk cache + our spillover files: `get_search_content({responseId, findText})` with exact-offset passages. Combine with the budget-aware disclosure above and the model can navigate a 500K-token doc in a 20K-token window.
- **Stay under 1 MB installed.** Their 7.1 MB and 8 deps vs. our 5 deps is a real selling point for `pi install` on CI boxes. Adopt the "Non-Goals" list as a public README section — leanness as an explicit contract, not an accident.
- **Deterministic, auditable output** — no curator UI, no summary model in the loop. Position: the extension for people who want the agent to read *sources*, not model-generated digests. `source_check` (3.3) fits this identity; the curator does not.

Priority for "genius": F-1 → CI/tests → query-aware section ranking → context-aware progressive disclosure → content store. The last three together are a capability pi-web-access doesn't have and can't easily retrofit onto char-slicing.