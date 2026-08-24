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

### 2.1 `get_fetch_content` returns truncated content, not full content

`content-processor.ts`'s `processContent()` returns `mainContent: selected.markdown` — the budget-*selected*, already-truncated text. The pre-truncation `markdown` variable is only ever written to `spillover.ts`, never returned. `tool-fetch.ts` then stores `extracted.mainContent` into `ContentStore`, so `get_fetch_content({ handle })` hands back the same truncated text a second time — not the full page it advertises.

**Fix:** `processContent()` needs to return (or `tool-fetch.ts` needs to separately capture) the untruncated `markdown` before section-selection, and store *that* in `ContentStore` when `selected.truncated` is true. The spillover-file and in-memory-store paths should read from the same source of truth — right now they diverge silently.

**Also affected:** handles are only created on the generic HTML path. Truncated PDF and GitHub-specialized responses (`github-handler.ts`) don't get a handle at all — `get_fetch_content` silently can't help there. Extend handle creation to those paths in the same pass.

### 2.2 Fallback results are cached under the wrong provider's key

In `tool-search.ts`, the cache key is built from `primaryProvider` (the requested or auto-selected provider) *before* `registry.searchWithFallback()` runs:

```ts
const cacheKey = cache.key(params.query, [primaryProvider], options);
// ...
const response = await registry.searchWithFallback(fallbackChain, params.query, options, signal);
cache.set(cacheKey, response.results);   // ← stored under primaryProvider's key
```

If `primaryProvider` fails and a later entry in the chain succeeds, the result is correct and correctly labeled on the *first* (uncached) response — but the cache entry itself is keyed and, on the next hit, formatted as if it came from `primaryProvider`. If Exa is down and Brave answers, a cached hit later claims the results are from Exa. Worse: if Exa later recovers, the cache will keep serving stale Brave-sourced results under Exa's identity until the entry expires.

**Fix:** key the cache entry (and format the cached-hit response) using `response.provider`, the provider that actually answered — not the one that was asked first. `SearchCache`'s key function may need the actual provider passed in after the fact, or the set/format calls reordered so the real provider is known before either happens.

### 2.3 "Answer mode" doesn't use the prompt for extraction

`applyAnswerMode()` in `tool-fetch.ts` prepends a `> **Question**: {prompt}` header to output that was computed identically to plain `extract` mode — `prompt` never reaches `rankSections()` or `selectSections()`. The tool's own `promptGuidelines` claim mode: "answer" gets "sections most relevant to a specific question instead of the full page," which isn't true today.

**Fix — pick one:**
- **(a) Make it real:** thread `prompt` into `rankSections()` as a boost signal (simple keyword/lexical overlap between prompt and section text is enough for v1 — no embeddings needed) so answer mode actually changes which sections are selected, not just how they're labeled.
- **(b) Rename it to match reality:** if (a) is deferred, rename the mode and its description to something honest (e.g. `mode: "framed"`) and drop the "focuses extraction" language until it's true.

(a) is the better long-term fix and was already scoped in the original roadmap's Phase 7 — do it here instead of shipping a second misleading label.

---

## Phase 3 — P1: security gaps that are concrete, not theoretical

**Why third, not first:** none of these are currently exploitable through the extension's own tool interface without the model being told to fetch a specific malicious host — they harden the guard, they don't close an open door the way Phase 1/2 items do. Still real, still worth fixing before broader adoption.

### 3.1 SSRF range coverage gaps

`isBlockedIpv4`/`isBlockedIpv6` in `ssrf.ts` are missing six documented special-use ranges:

| Range | Purpose | Status |
|---|---|---|
| `192.0.2.0/24` | TEST-NET-1 | Missing |
| `198.51.100.0/24` | TEST-NET-2 | Missing |
| `224.0.0.0/4` | Multicast | Missing |
| `240.0.0.0/4` | Reserved | Missing |
| `::` | IPv6 unspecified | Missing |
| `ff00::/8` | IPv6 multicast | Missing |

**Fix:** add the missing octet/prefix checks directly (cheap, matches the existing style), or replace the hand-rolled range table with a maintained CIDR-classification library (`ip-address`, `netmask`, or similar) so future IANA allocations don't require another manual audit. Given how many gaps a single review pass found, the maintained-library route is the more defensible long-term choice.

### 3.2 GitHub handler bypasses the bounded reader

`github-handler.ts:144` calls `response.json()` directly on a `safeFetch()` response instead of routing through `readBoundedText`/`readBoundedArrayBuffer`. The 5 MB cap that `safe-fetch.ts` was built to guarantee doesn't apply here — a large or lying `Content-Length` on a GitHub API response isn't caught.

**Fix:** read the body via `readBoundedText()` first, `JSON.parse()` after — same pattern already used two lines earlier in the same file (line 110, README fetch).

### 3.3 Domain policy has no trailing-dot normalization

`matchesDomainEntry()` does exact/suffix string comparison with no `.replace(/\.$/, "")` step. A hostname with a trailing dot (a valid FQDN form) won't match an allow/deny entry written without one.

**Fix:** normalize both `hostname` and each policy `entry` (strip trailing dot, already-lowercased) before comparing. Small, contained, add a test case with a trailing-dot input.

### 3.4 DNS-rebinding TOCTOU (documented, not fixed)

Unchanged from earlier reviews: `validateFetchUrl()` resolves the hostname once, `fetch()` resolves it again independently. Still requires resolved-IP pinning (custom undici `Agent`) to close properly — larger change than 3.1–3.3, correctly deferred, correctly documented in the README rather than hidden.

---

## Phase 4 — Testing infrastructure hardening

**Why fourth:** the Phase 0 fix solved the immediate breakage; these prevent the same *shape* of bug from recurring.

### 4.1 Add the "does it actually install" smoke test

Covered under 1.2 — listed here too because it's a testing-infrastructure change as much as a packaging fix. Belongs in CI as a permanent step, not a one-time manual check.

### 4.2 Fix the fallback test that doesn't test fallback

`tests/tool-search.test.ts`'s "falls through to second provider when first fails" test calls `execute()` with an explicit `provider: "brave"` — which the code's own logic treats as a single-entry chain, no fallback. The test contains its own admission: `// We can't easily inject the registry — but we can verify the fallback by testing with an explicit brave provider (no fallback scenario)`. It currently proves nothing about fallback behavior.

**Fix:** now that Phase 0 established the pattern for injecting test keys into the shared singleton, use the same approach here — stub the primary provider's `fetch()` to fail, omit `provider:` from the params so `suggestProvider()` picks a primary and the real fallback chain runs, and assert the response came from the secondary provider.

### 4.3 Singleton test isolation (minor, worth tracking)

The Phase 0 fix mutates the shared `registry` singleton (`registry.register("brave", new BraveProvider("test-brave-key"))`) rather than constructing an isolated instance. Fine for the current single-process test run since only this file touches the singleton's search behavior, but it's a latent footgun — a future test file that also imports `registry` inherits whatever the last-run file left in it. `registry.test.ts` already shows the cleaner pattern (isolated `new ProviderRegistry()` instances). Worth a follow-up to migrate `tool-search.test.ts` to the same isolation model once 4.2's rewrite touches the file anyway.

### 4.4 Missing coverage from the original review, still open

- Config values actually affecting runtime behavior (partially covered now that 2.2/2.3-adjacent config fields are wired — add regression tests for `defaultProvider`, `maxResults`, `maxInlineContentChars` specifically, not just `fallbackOrder`)
- Cache attribution after fallback (write this alongside the 2.2 fix — it's the regression test for that bug)
- Truncated PDF / GitHub handle creation (regression test for 2.1)
- `web_search`'s total output size — `fullContent` per result can run to ~30K chars with no overall budget across multiple results, unlike `web_fetch`'s token-budgeted path

---

## Phase 5 — Documentation and governance polish

**Why last:** none of these block correctness or installability; they're accuracy and process hygiene.

### 5.1 Reconcile every "field documented but semantics wrong" case

`maxInlineContentChars`'s README description ("Max characters returned inline by `web_fetch` before spillover") no longer matches where it's actually wired (`web_search`'s per-result `fullContent` truncation in `format.ts`). Either move the field to control what the README says it controls, or rewrite the description to match where it landed. Do this as part of Phase 2, not separately — don't let a doc description survive a behavior change again.

### 5.2 CI: add the checks that are still missing

Version-consistency + typecheck + lint + test is a solid minimum, but nothing currently runs:
- Dependency/supply-chain review (`npm audit` or equivalent, gating on new high/critical advisories)
- Coverage reporting (doesn't need a hard gate yet, but visibility would have made the truncated-content-store bug in 2.1 easier to catch)
- CodeQL or equivalent static analysis
- The Phase 1.2 install smoke test, as its own job

### 5.3 Governance

Single-branch, same-day commit history is fine for a solo pre-1.0 project and isn't worth manufacturing process around artificially — but now that `main` exists, treat it as the real default branch (branch protection requiring the CI check to pass before merge) rather than a parallel copy of `develop`, so v1.0.2-and-later isn't self-certified by the same commit that changes the code.

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