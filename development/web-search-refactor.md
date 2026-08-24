# web-search Extension Refactor Guideline

> Target: **≥ 9/10** across all criteria. Current baseline: **7.8/10** overall
> (extension code 8.5, project foundation 6.5).
>
> Supersedes `refactor_v2.md` / `refactor_v3.md` (deleted — both were point-in-time
> rerating snapshots against 0.3.6 and 0.4.x, now stale). This doc reflects the
> actual source at **v0.5.1**, verified via a clean `npm run check` (typecheck +
> lint + 140 tests, all pass), the live CI workflow, and line-level reading of
> every file referenced below — not trusted from the CHANGELOG.
>
> Benchmark: [`pi-web-access`](https://pi.dev/packages/pi-web-access) v0.24.0
> (25 providers, 4 tools, zero-config Exa) — carried over from the prior audit,
> not re-verified live this round.

---

## Current Scores vs. Targets

| # | Criterion | Now | Target | Key Gap |
|---|-----------|:---:|:------:|---------|
| 1 | Architecture | 8.5 | 9 | Clean 24-file split, `index.ts` 113 LOC factory — only debt left is the module-level singleton `ProviderRegistry` (not injectable, not testable in isolation) |
| 2 | Code Quality | 8.5 | 9 | Status-aware retry, real key injection, safe-fetch layer — clean `tsc`/`eslint`. Cosmetic-only: unused `TokenCountMode.exact_remote` variant left in the union type after the Anthropic remote counter was deleted |
| 3 | Testing | 8 | 9 | 140 tests across 12 of 24 `src/` files (up from 26% file coverage). Gap is integration coverage: no test exercises a tool's `execute()` end-to-end against a mocked HTTP layer and asserts the *formatted* output shape |
| 4 | Pi API Usage | 9 | 10 | `session_start`, `model_select`, `ctx.getContextUsage()`, `ctx.hasUI`/`ctx.ui`, `registerCommand`, `registerTool` all in active use. `session_shutdown` remains the one unused lifecycle hook (spillover cleanup) |
| 5 | Provider Design | 7 | 9 | Still Brave + Tavily only. `ProviderRegistry.getProvider()` falls back to default only when the *name* is unregistered — there's no fallback on a provider *failing* (missing key, request error) for single-provider calls |
| 6 | Content Pipeline | 8 | 9 | HTML + PDF extraction, section ranking, JSON-LD/OpenGraph structured extraction — solid. No JS-render fallback, no GitHub/YouTube handling, no RSC/Next.js flight-data parsing |
| 7 | Documentation | 7.5 | 9 | README and CHANGELOG are genuinely good (self-correcting, evidence-cited) — pulled down by a live LICENSE/package.json conflict and (until this pass) three overlapping planning docs in `development/` |
| 8 | Security | 8.5 | 9 | Real SSRF guard (DNS-checked, per-hop redirect validation, 5 MB cap), documented DNS-rebinding TOCTOU limitation. Missing: rate limiting, domain allow/deny policy |
| 9 | Maintainability | 9 | 9 | CI enforces version-consistency + typecheck + lint + test on every push — the exact bug class that recurred twice (package.json/CHANGELOG drift) is now structurally blocked, not just documented |
| 10 | Feature Completeness | 6.5 | 9 | Missing `source_check`, GitHub clone handling, batch queries, JSON config file, `answer` mode, `get_search_content` |
| 11 | Ecosystem Fit | 5.5 | 9 | pi manifest works locally today; not published. The name `web-search` is already taken on the npm registry by an unrelated package — this blocks publishing as-is, not just "hasn't happened yet" |
| | **Overall** | **7.8** | **9+** | |

---

## Completed — verified against source, not changelog trust

### Phase 1 — Foundation (v0.3.5)

| Item | What | Verified |
|------|------|----------|
| Model table removed | `MODEL_CONFIGS`/`PROVIDER_FALLBACKS`/`detectProvider` deleted from `token-budget.ts`; replaced with `buildBudget(model, contextWindow, maxTokens, provider)` — pure ratio math (`TOOL_RESERVE_RATIO = 0.05`, `SAFETY_MARGIN = 0.05`), fed entirely by the `model_select` event payload. `buildUnknownBudget()` covers the pre-`model_select` case with `UNKNOWN_DEFAULTS` (100K context, 4K output). Zero model names anywhere in `src/`. | ✅ read `token-budget.ts` directly |
| Stale tests fixed | Model-name assertions replaced with ratio-math tests | ✅ `token-budget.test.ts` passes, no model-name literals |
| Cache reset on session lifecycle | `pi.on("session_start", ...)` clears the cache | ✅ confirmed in current `index.ts` (see Phase 3 below — this was later hardened further) |
| `process.cwd()` fixed | `spillover.ts` no longer captures cwd at module load; accepts `cwd` param from callers | ✅ read `spillover.ts` |
| Shared `selectSections()` | Single `section-selector.ts`, rank-sort preserved, both HTML and PDF paths import it | ✅ read `section-selector.ts`, `content-processor.ts`, `pdf-extractor.ts` |
| `index.ts` split | 335 LOC → `tool-search.ts` / `tool-fetch.ts` / `format.ts` / `index.ts` | ✅ current `index.ts` is 113 LOC (grew back up slightly since — see Phase 3, commands were added) |

### Phase 2 — Deep Pi Integration (v0.3.6)

| Item | What | Verified |
|------|------|----------|
| Anthropic remote token counting removed | `AnthropicTokenCounter` (raw `fetch()` to `api.anthropic.com`) deleted; Anthropic models use the heuristic counter (chars ÷ 3–4) | ✅ `token-counter.ts` has no Anthropic API call |
| `ctx.getContextUsage()` wired in | `tool-fetch.ts` computes `effectiveContentBudget(staticBudget, usage.tokens)`, clamped to `[0, staticBudget]` | ✅ read `token-budget.ts`'s `effectiveContentBudget()` + its 6-case test suite |
| Keychain gated to macOS | `resolveApiKey()` only shells to `/usr/bin/security` when `process.platform === "darwin"`; falls through to env var → `.env` otherwise, with a platform-appropriate error message | ✅ read `keychain.ts` |

### Phase 3 — Regression Hardening (v0.5.0–0.5.1)

This round wasn't in either prior plan — it's the response to five regressions a `refactor_v3.md` audit found in the two releases immediately after Phase 2. All five are fixed and verified here independently.

**CI + version-consistency gate.** `scripts/check-version.mjs` compares `package.json`'s version against `CHANGELOG.md`'s top entry and fails the build on drift. Wired into `.github/workflows/pi-web-search-check.yml` as its own step, before typecheck/lint/test:

```yaml
- name: Version consistency
  working-directory: .pi/extensions/web-search
  run: node scripts/check-version.mjs
- name: Typecheck
  run: npm run typecheck
- name: Lint
  run: npm run lint
- name: Test
  run: npm run test
```

Ran both `node scripts/check-version.mjs` and the full workflow locally — clean. This closes the bug class that hit `package.json`/`CHANGELOG.md` twice (0.3.4/0.3.3, then 0.4.1/0.4.0) without a human catching it either time.

**`safe-fetch.ts` — real hardening, not cosmetic.** Replaces `redirect: "follow"` + post-hoc `response.url` checking (the blocked hop's request had already fired by the time you can inspect it) with `redirect: "manual"` and per-hop `validateFetchUrl()`, capped at 5 hops:

```ts
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  let target = await validateFetchUrl(url);
  for (let hop = 0; ; hop++) {
    const response = await fetchWithRetry(target, { ...options, redirect: "manual" }, options);
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects fetching ${url}`);
    const location = response.headers.get("location");
    target = await validateFetchUrl(new URL(location!, target).toString());
  }
}
```

Plus a 5 MB response cap (`readBoundedArrayBuffer` / `readBoundedText`), enforced via `Content-Length` when present and by aborting the stream mid-read otherwise, since a server can omit or lie about `Content-Length`. Wired into both `web_fetch` and `BraveProvider.fetch()`. The one documented, unfixed gap: DNS-rebinding TOCTOU — `validateFetchUrl()` resolves the hostname, then `fetch()` resolves it again independently a moment later, so a DNS answer that changes in between isn't caught. A real fix needs resolved-IP pinning (a custom undici `Agent`); flagged in the README as out of scope while every non-rebinding SSRF path is covered.

**Retry is now status-aware.** The old `withRetry(() => fetch(...))` only ever saw thrown errors — `fetch()` resolves (doesn't throw) on HTTP 429/502/503/504, so retry attempts for those statuses were dead code. `fetchWithRetry()` in `retry.ts` inspects `response.status` inside the loop:

```ts
if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
  await delay(retryDelayMs(response, delayMs, attempt)); // honors Retry-After
  attempt += 1;
  continue;
}
```

`web_fetch` now actually retries (via `safeFetch`), which it didn't before despite an earlier changelog entry claiming it did.

**Provider tests no longer depend on ambient environment.** `BraveProvider`/`TavilyProvider` take an optional constructor `apiKey` that skips `resolveApiKey()` (Keychain → env → `.env`) entirely when supplied. The old tests only passed because the author's machine happened to have real keys set — they'd fail on any clean/keyless runner, which is exactly what CI now is.

**`/websearch` shares the session cache.** Previously called the provider directly, so a `/websearch foo` followed by the model searching `foo` paid for the same query twice. Now uses the same `cache.key(query, [provider], options)` lookup as the `web_search` tool — confirmed in current `index.ts`'s `websearch` command handler.

**Cache-clear bug fixed properly.** `SearchCache` is now mutated in place (`cache.clear()`) rather than reassigned inside the `session_start` handler, and both tools take `() => cache`/similar getters so the closure always sees the live instance — not a stale snapshot from registration time.

**Widget simplified.** 0.5.1 dropped the `Ctrl+Shift+W` toggle; `renderSearchWidget()` always renders on `session_start` and after every search/command, showing live cache size.

---

## Open — Project Foundation

These are repo-level, not code-level, and weren't caught by any prior code review because prior reviews only looked at `.pi/extensions/web-search/`.

### ~~License conflict~~ ✅ Fixed in v0.6.0

~~Root `LICENSE` is Non-Commercial Source-Available License (NCSAL) — copyright Sven Hornaff, non-commercial use only. But:
- `.pi/extensions/web-search/package.json` declares `"license": "MIT"`.
- The extension's own `README.md` has a `## License` section that says `MIT`.~~

Fixed: `package.json` now declares `"license": "NCSAL"`. Extension README updated with correct license statement and link to root `LICENSE`. All three sources now agree.

### ~~npm name is squatted~~ ✅ Fixed in v0.6.0

~~An unrelated package already owns `web-search` on the public registry (currently at 0.6.2, a URL-generator package with no relation to this project).~~

Fixed: package renamed to `@svenhornaff/web-search` (scoped, permanently squatting-proof). This is the final name — not changing again.

### Single squashed commit, no default branch

```
$ git log --oneline --all
b361ec5 chore: initial commit — web-search v0.5.1
$ git branch -a
* develop
  remotes/origin/develop
$ git tag
v0.5.1
```

The entire 0.1.0 → 0.5.1 history described across 14 CHANGELOG entries happened before this repo existed in its current form — there's no commit trail to `git blame` or `git bisect` against, and no `main`/`master`, only `develop`. Not blocking, but decide whether `develop` becomes the default branch or a `main` gets cut from it — GitHub's UI and any future CI branch-protection rules will assume one exists.

### ~~`session_shutdown` still unused~~ ✅ Fixed in v0.6.0

~~Spillover files cleaned only opportunistically.~~ Fixed: `session_shutdown` now calls `cleanExpiredSpillover(ctx.cwd)` (fire-and-forget).

---

## Open — Phase 4: Feature Parity + Differentiation (Score: 6.5 → 9)

_Goal: match `pi-web-access` on the features that matter, without chasing its breadth._

### ~~4.1 Provider Fallback Chain~~ ✅ Done v0.7.0

`ProviderRegistry.searchWithFallback()` added. Auto-selected calls try
providers in `config.fallbackOrder` order; explicit `provider:` param
still means no fallback. 7 tests in `tests/registry.test.ts`.

### ~~4.2 Exa Provider~~ ✅ Done v0.8.0

`src/providers/exa.ts` implemented against `POST https://api.exa.ai/search`.
Resolves `EXA_API_KEY` via Keychain/env/`.env`. Returns `fullContent` alongside
results (Exa `text` field). Registered first in fallback chain — if no key,
fallback chain transparently moves to Brave/Tavily. 29 tests in `tests/exa.test.ts`.

**Note on zero-config**: Exa's hosted MCP server (`https://mcp.exa.ai/mcp`) works
without a key but is an MCP protocol endpoint — not a REST API callable via `fetch()`.
True zero-config REST search isn’t available from Exa’s public API. The fallback
chain means users with only a Brave or Tavily key still get full functionality.

### ~~4.3 JSON Config File~~ ✅ Done v0.7.0

`src/config.ts` loads `~/.pi/web-search.json` (or `$PI_CODING_AGENT_DIR/web-search.json`)
on every `session_start`. Fields: `defaultProvider`, `fallbackOrder`, `maxResults`,
`maxInlineContentChars`. `$ENV_VAR` interpolation, soft-fail on missing/malformed file.
17 tests in `tests/config.test.ts`.

### 4.4 `source_check` Tool

**Why:** `pi-web-access` has this; genuinely useful for verifying a specific claim against live sources rather than a general search.

**How:** Register as a third tool alongside `web_search`/`web_fetch`:
1. Run `web_search` with the claim as the query.
2. Fetch the top N results via the existing `web_fetch` pipeline (reuse `safeFetch` + section selection).
3. Return `{ status: "supported" | "contradicted" | "unclear", sources: [...], passages: [...] }`.

No new infrastructure needed — this is a composition of the two existing tools plus a structured output shape.

### ~~4.5 GitHub URL Handling~~ ✅ Done v0.9.0

`src/github-handler.ts` routes blob/tree/root URLs to raw.githubusercontent.com
or the GitHub API before falling through to HTML. 13 tests in `tests/github-handler.test.ts`.

### ~~4.6 Batch Queries~~ ✅ Done v0.9.0

`queries: string[]` (2–5) added to `web_search`. Runs in parallel via
`Promise.allSettled`, deduplicates with `search-aggregator.ts`. Cache keyed on
joined query string. 3 batch tests in `tests/tool-search.test.ts`.

### ~~4.7 JS-Render Fallback~~ ✅ Done v0.9.0

Jina Reader fallback (`https://r.jina.ai/<url>`) added to `content-processor.ts`.
Triggered when extraction yields < 50 estimated tokens. No API key needed.

---

## ~~Open — Phase 5: Testing~~ ✅ Done v0.9.0

- Integration tests added: `tests/tool-search.test.ts` (9 tests, execute() end-to-end),
  `tests/github-handler.test.ts` (13 tests).
- `execute()` signature aligned (ctx param).
- Provider fallback behavior covered in `tests/registry.test.ts` (Sprint 2).

---

## Open — Phase 6: Distribution & Ecosystem (Score: 5.5 → 9)

### ~~6.1 Resolve the Name, Then Publish~~ ✅ Name resolved v0.6.0 — publish pending npm login

Name is `@svenhornaff/web-search` (final, scoped, squatting-proof). Package is
ready to publish — blocked only by `npm login` / `npm adduser` on this machine.
Run `npm login` then `npm publish --access public` from `.pi/extensions/web-search/`.

### 6.2 Commands, Shortcut, Widget

Already done as of 0.5.x — `/websearch`, `/websearch-cache`, and the always-on status widget are live in `index.ts`. Nothing further needed here; listed for completeness against the original Phase 5 scope.

---

## Open — Phase 7: Advanced (Score: 9 → 10)

### ~~7.1 `answer` mode~~ ✅ Done v1.0.0

`mode: "answer"` + `prompt` params added to `web_fetch`. Reframes output with
a relevance header. Section ranking surfaces best content; no second LLM call.

### ~~7.2 Stored content retrieval~~ ✅ Done v1.0.0

`get_fetch_content` tool + `ContentStore` (in-session, 30-min TTL). When
`web_fetch` truncates, it stores full markdown and sets `details.handle`. Model
calls `get_fetch_content({ handle })` with optional `findText`/`sectionIndex`.
8 tests in `tests/content-store.test.ts`.

### ~~7.3 Rate Limiting~~ ✅ Done v1.0.0

`src/rate-limiter.ts` token-bucket limiter. Brave: 1 req/s, Tavily: 5, Exa: 5.
Wired into `ProviderRegistry.searchWithFallback()` and `searchAll()`.
`setRateLimit()` for test overrides. 4 tests in `tests/rate-limiter.test.ts`.

### ~~7.4 Domain Policy~~ ✅ Done v1.0.0

`domainPolicy: { allow, deny }` in `WebSearchConfig`. `checkDomainPolicy()` in
`ssrf.ts`, checked in `tool-fetch.ts` before every fetch. Deny wins. Suffix
matching. 14 tests in `tests/domain-policy.test.ts`.

### ~~7.5 RSC / Next.js Flight Data Parser~~ ✅ Done v1.0.0

`src/rsc-parser.ts` — extracts text from `self.__next_f.push(...)` scripts
before falling back to Jina. No extra network round-trip for Next.js pages.
7 tests in `tests/rsc-parser.test.ts`.

---

## Implementation Order

| Sprint | Work | Score Impact |
|--------|------|:------------:|
| ~~**1**~~ | ~~License conflict + npm name decision (Open — Project Foundation)~~ ✅ **Done v0.6.0** | Documentation 7.5→8.5, unblocks 6.1 |
| ~~**2**~~ | ~~4.1 (fallback chain) + 4.3 (config file)~~ ✅ **Done v0.7.0** | Provider Design 7→8, Ecosystem Fit 5.5→7 |
| ~~**3**~~ | ~~4.2 (Exa provider) + 6.1 (publish name resolved)~~ ✅ **Done v0.8.0** (publish pending npm login) | Ecosystem Fit 7→8.5 |
| ~~**4**~~ | ~~4.5–4.7 (GitHub, batch, fetch fallback) + Phase 5 integration tests~~ ✅ **Done v0.9.0** | Feature Completeness 6.5→8, Testing 8→9 |
| ~~**5**~~ | ~~7.1–7.5 (answer mode, stored content, rate limiting, domain policy, RSC)~~ ✅ **Done v1.0.0** | 9→9.5+ |