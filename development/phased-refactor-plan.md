# web-search Extension — Phased Refactor Plan (v1.0.2, Aug 24 2026)

> Current rating: **6.9/10** (extension code 7.0, project foundation 6.5). See
> the external-review validation this plan is built from — every finding below
> was independently re-verified against source, not taken on trust.
>
> The CI-breaking regression (8 tests failing on any keyless runner) that
> blocked prior sprints is **fixed as of v1.0.2** — root-caused correctly
> (`resolveApiKey()` shells to Keychain, not `fetch()`, so stubbing `fetch()`
> never intercepted it) and verified here with `env -i HOME=/tmp/ci-home-test`,
> matching the fix commit's own reproduction method: 251/251 pass, exit 0.
>
> This plan sequences the remaining open findings by severity and blast
> radius, not by how they were originally discovered. Each item lists the
> exact evidence, not a restated claim.

---

## Phase 0 — Already done, verified (no action needed)

| Item | Evidence |
|---|---|
| CI-breaking test regression | `tests/tool-search.test.ts` now re-registers the singleton `registry` with injected test keys before any test runs; reproduced keyless, 251/251 pass |
| License conflict | Root `LICENSE` (NCSAL), extension `package.json`, extension `README.md` all agree |
| npm name squatting | Renamed to `@svenhornaff/web-search`, scope confirmed free on the registry |
| `session_shutdown` unused | Now wired: `cleanExpiredSpillover(ctx.cwd)`, fire-and-forget |
| `defaultProvider` / `maxResults` config fields dead | Both now read and applied in `tool-search.ts` |
| Provider fallback chain | `ProviderRegistry.searchWithFallback()` — real, tested, correctly distinguishes explicit `provider:` (no fallback) from auto-selected (chain runs) |
| No `main` branch | Created and pushed |

---

## Phase 1 — P0: npm packaging is broken

**Why first:** every other fix in this plan is irrelevant if the package can't be installed. This is the one item that would fail for 100% of users on first try, not a subset.

### 1.1 Add the missing `dependencies` block

`@svenhornaff/web-search/package.json` declares zero runtime dependencies. `src/` imports six packages that exist only in the parent workspace (`.pi/extensions/package.json`):

```
linkedom, turndown, turndown-plugin-gfm, pdf-parse, js-tiktoken, @sinclair/typebox
```

**Fix:** add a real `"dependencies"` block to the extension's own `package.json`, versions matching the parent's. `@sinclair/typebox` is currently a `peerDependency` in the parent — decide whether it stays peer (consumer must provide it) or becomes a direct dependency here; either is defensible, but it must be a deliberate choice, not an omission.

### 1.2 Prove it with a real install, not a workspace-relative check

`npm run check` passing inside the monorepo says nothing about the published artifact. Before closing this item:

```bash
cd .pi/extensions/web-search
npm pack
mkdir -p /tmp/pi-web-search-smoke && cd /tmp/pi-web-search-smoke
npm init -y && npm install /path/to/svenhornaff-web-search-1.x.x.tgz
node -e "require('@svenhornaff/web-search')"   # or the ESM equivalent used by pi's loader
```

Add this as a CI step (`npm pack` → install into a throwaway dir → smoke-import) so this class of bug can't ship again. This is the same lesson as the test-key regression in Phase 0: a check that only runs inside the monorepo doesn't verify what actually ships.

### 1.3 Fix the stale "dual-provider" / "Brave + Tavily" claims while touching these files

Three places still describe 2 providers when there are 3 (Exa/Brave/Tavily):
- Root `README.md` line 3
- `src/index.ts` header comment
- extension `package.json`'s `"description"` field

Cheap, low-risk, and touches the exact file (`package.json`) already being edited in 1.1 — bundle it in rather than opening a separate PR.

---

## Phase 2 — P1: correctness bugs in advertised features

**Why second:** these aren't missing features, they're features that exist, are documented, and don't do what the documentation says. That's worse for trust than an honest gap.

### ~~2.1~~ ✅ Fixed v1.2.0 — `get_fetch_content` returns truncated content, not full content

**Was:**

`content-processor.ts`'s `processContent()` returns `mainContent: selected.markdown` — the budget-*selected*, already-truncated text. The pre-truncation `markdown` variable is only ever written to `spillover.ts`, never returned. `tool-fetch.ts` then stores `extracted.mainContent` into `ContentStore`, so `get_fetch_content({ handle })` hands back the same truncated text a second time — not the full page it advertises.

**Fix:** `processContent()` needs to return (or `tool-fetch.ts` needs to separately capture) the untruncated `markdown` before section-selection, and store *that* in `ContentStore` when `selected.truncated` is true. The spillover-file and in-memory-store paths should read from the same source of truth — right now they diverge silently.

**Fixed:** `ExtractedContent.fullMarkdown` added; `maybeStoreHandle()` helper stores it; handle creation extended to PDF+GitHub paths.

**Was (original):** handles were HTML-only.

### ~~2.2~~ ✅ Fixed v1.2.0 — Fallback results are cached under the wrong provider's key

**Was:**

In `tool-search.ts`, the cache key is built from `primaryProvider` (the requested or auto-selected provider) *before* `registry.searchWithFallback()` runs:

```ts
const cacheKey = cache.key(params.query, [primaryProvider], options);
// ...
const response = await registry.searchWithFallback(fallbackChain, params.query, options, signal);
cache.set(cacheKey, response.results);   // ← stored under primaryProvider's key
```

If `primaryProvider` fails and a later entry in the chain succeeds, the result is correct and correctly labeled on the *first* (uncached) response — but the cache entry itself is keyed and, on the next hit, formatted as if it came from `primaryProvider`. If Exa is down and Brave answers, a cached hit later claims the results are from Exa. Worse: if Exa later recovers, the cache will keep serving stale Brave-sourced results under Exa's identity until the entry expires.

**Fixed:** `cache.set` now uses `response.provider` (actual answerer), not `primaryProvider`.

### ~~2.3~~ ✅ Fixed v1.2.0 — "Answer mode" doesn't use the prompt for extraction

**Was:**

`applyAnswerMode()` in `tool-fetch.ts` prepends a `> **Question**: {prompt}` header to output that was computed identically to plain `extract` mode — `prompt` never reaches `rankSections()` or `selectSections()`. The tool's own `promptGuidelines` claim mode: "answer" gets "sections most relevant to a specific question instead of the full page," which isn't true today.

**Fix — pick one:**
- **(a) Make it real:** thread `prompt` into `rankSections()` as a boost signal (simple keyword/lexical overlap between prompt and section text is enough for v1 — no embeddings needed) so answer mode actually changes which sections are selected, not just how they're labeled.
- **(b) Rename it to match reality:** if (a) is deferred, rename the mode and its description to something honest (e.g. `mode: "framed"`) and drop the "focuses extraction" language until it's true.

**Fixed:** `prompt` threaded into `rankSections()` as `promptHint`; lexical overlap boosts matching sections' rank (+20 title, +10 body, capped +60).

---

## Phase 3 — P1: security gaps that are concrete, not theoretical

**Why third, not first:** none of these are currently exploitable through the extension's own tool interface without the model being told to fetch a specific malicious host — they harden the guard, they don't close an open door the way Phase 1/2 items do. Still real, still worth fixing before broader adoption.

### ~~3.1~~ ✅ Fixed v1.3.0 — SSRF range coverage gaps

**Was:**

`isBlockedIpv4`/`isBlockedIpv6` in `ssrf.ts` are missing six documented special-use ranges:

| Range | Purpose | Status |
|---|---|---|
| `192.0.2.0/24` | TEST-NET-1 | Missing |
| `198.51.100.0/24` | TEST-NET-2 | Missing |
| `224.0.0.0/4` | Multicast | Missing |
| `240.0.0.0/4` | Reserved | Missing |
| `::` | IPv6 unspecified | Missing |
| `ff00::/8` | IPv6 multicast | Missing |

**Fixed:** all six ranges added inline. Also fixed IPv6 bracket-stripping bug (`url.hostname` returns `[::1]`; `isIP()` needs `::1`). 15 new tests.

### ~~3.2~~ ✅ Fixed v1.3.0 — GitHub handler bypasses the bounded reader

**Was:**

`github-handler.ts:144` calls `response.json()` directly on a `safeFetch()` response instead of routing through `readBoundedText`/`readBoundedArrayBuffer`. The 5 MB cap that `safe-fetch.ts` was built to guarantee doesn't apply here — a large or lying `Content-Length` on a GitHub API response isn't caught.

**Fixed:** both `response.json()` calls in `fetchTreeListing` and `fetchRepoRoot` replaced with `readBoundedText()` + `JSON.parse()`.

### ~~3.3~~ ✅ Fixed v1.3.0 — Domain policy trailing-dot normalization

**Was:**

`matchesDomainEntry()` does exact/suffix string comparison with no `.replace(/\.$/, "")` step. A hostname with a trailing dot (a valid FQDN form) won't match an allow/deny entry written without one.

**Fixed:** trailing dots stripped from both `hostname` and `entry` before comparison. 5 new tests.

### 3.4 DNS-rebinding TOCTOU (documented, not fixed)

Unchanged from earlier reviews: `validateFetchUrl()` resolves the hostname once, `fetch()` resolves it again independently. Still requires resolved-IP pinning (custom undici `Agent`) to close properly — larger change than 3.1–3.3, correctly deferred, correctly documented in the README rather than hidden.

---

## Phase 4 — Testing infrastructure hardening

**Why fourth:** the Phase 0 fix solved the immediate breakage; these prevent the same *shape* of bug from recurring.

### 4.1 Add the "does it actually install" smoke test

Covered under 1.2 — listed here too because it's a testing-infrastructure change as much as a packaging fix. Belongs in CI as a permanent step, not a one-time manual check.

### ~~4.2~~ ✅ Fixed v1.2.0 — Fix the fallback test that doesn't test fallback

**Was:**

`tests/tool-search.test.ts`'s "falls through to second provider when first fails" test calls `execute()` with an explicit `provider: "brave"` — which the code's own logic treats as a single-entry chain, no fallback. The test contains its own admission: `// We can't easily inject the registry — but we can verify the fallback by testing with an explicit brave provider (no fallback scenario)`. It currently proves nothing about fallback behavior.

**Fixed:** two new tests with isolated `ProviderRegistry`; keyless Exa throws, Brave answers; assert `response.provider === "brave"` and cache key is `"brave"`.

### ~~4.3~~ ✅ Fixed v1.2.0 — Singleton test isolation

**Was:**

The Phase 0 fix mutates the shared `registry` singleton (`registry.register("brave", new BraveProvider("test-brave-key"))`) rather than constructing an isolated instance. Fine for the current single-process test run since only this file touches the singleton's search behavior, but it's a latent footgun — a future test file that also imports `registry` inherits whatever the last-run file left in it. `registry.test.ts` already shows the cleaner pattern (isolated `new ProviderRegistry()` instances). **Fixed:** fallback tests use `new ProviderRegistry()` instances.

### ~~4.4~~ ✅ Fixed v1.4.0 — Missing coverage

- **`defaultProvider`, `maxResults`, `maxInlineContentChars`**: 7 new tests in
  `tests/config-runtime.test.ts` confirm each field propagates to the real
  call-site. Keyless-verified.
- **Cache attribution after fallback**: covered in Phase 2 (`tool-search.test.ts`
  — “cache entry keyed under actual provider, not primary”).
- **PDF `fullMarkdown`**: `extractPDF()` now sets `fullMarkdown: rawText` when
  truncated (completing Phase 2.1 for the PDF path).
- **`web_search` fullContent output size**: controlled by `maxInlineContentChars`
  (default 30K chars per result); documented and tested.

---

## Phase 5 — Documentation and governance polish

**Why last:** none of these block correctness or installability; they're accuracy and process hygiene.

### ~~5.1~~ ✅ Fixed v1.4.0 — Reconcile field documentation

`maxInlineContentChars` README description corrected: now says "Max characters
of `fullContent` included inline per `web_search` result. Does not affect
`web_fetch`."

### ~~5.2~~ ✅ Fixed v1.4.0 — CI checks

`npm audit --audit-level=high` step added to CI workflow. Smoke-install already
added in Phase 1.2. Coverage and CodeQL deferred.

### ~~5.3~~ ✅ Fixed v1.4.0 + post-release action — Governance

- CI `pull_request` trigger narrowed to `["main", "develop"]`.
- `main` fast-forwarded to `develop` (v1.4.0) and pushed.
- Branch protection applied via GitHub API (`gh api PUT /branches/main/protection`):
  - Required status check: `check` (the CI job name), strict mode
  - Force-pushes: disabled
  - Deletions: disabled
  - No PR review requirement (solo project)
- `main` is now the real default branch, CI-gated, not just a parallel copy.

---

## Sequencing summary

| Phase | Focus | Blocks | Unblocks |
|---|---|---|---|
| 0 | Already done | — | Everything below is trustworthy to build on |
| 1 | npm packaging | Publishing at all | Any real-world install |
| 2 | Correctness bugs in shipped features | Trust in `get_fetch_content`, cache correctness, answer mode | Feature completeness claims being true |
| 3 | Security range/reader/policy gaps | — | Full parity with the SSRF design's own documented intent |
| 4 | Testing infra | Confidence that Phase 1–3 fixes stay fixed | Safe iteration going forward |
| 5 | Docs & governance | — | Accurate self-description, branch-protected `main` |

Phases 1–2 are the ones that matter for calling this a safe 1.x. Phase 3–5 are what takes it from "solid" to the 8.5+ this codebase's architecture and TypeScript discipline are already good enough to support.