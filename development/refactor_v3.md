# web-search Extension — Rerating v3 (Aug 22 2026, post-Phase 4/5/6 claims, v0.4.x)

> Verified against source: full test run, typecheck, lint, and line-level verification of every changelog claim since v0.3.6.

## Rerating: 7.5 → **7.8/10**

Real gains (working SSRF guard, command/widget UX, F-1 properly fixed, package renamed) — but most of the feature delta was eaten by a cluster of process regressions, three of which are literally the failures the still-missing CI gate exists to catch.

| # | Criterion | v2 | Now | Target | Delta driver |
|---|-----------|:--:|:---:|:------:|--------------|
| 1 | Architecture | 8 | 8 | 9 | Commands/widget clean; `/websearch` bypasses the cache entirely (neither reads nor writes it) |
| 2 | Code Quality | 8.5 | 8 | 9 | Retry wrapper structurally can't retry what it claims (F-5) |
| 3 | Testing | 5.5 | 6.5 | 9 | +3 test files incl. SSRF + fixtures, 127 tests — but 2 shipped failing (F-6), CI absent |
| 4 | Pi API Usage | 9 | 9.5 | 10 | Commands, shortcut, widget, notify — full SDK surface, typechecks clean |
| 5 | Provider Design | 8 | 8 | 9 | Unchanged — no Exa, no fallback chain |
| 6 | Content Pipeline | 8.5 | 8.5 | 9 | Unchanged — still no response size cap |
| 7 | Documentation | 8.5 | 7.5 | 9 | CHANGELOG now contains two claims the code doesn't back (F-7), one duplicate entry, and version drift |
| 8 | Security | 7 | 8 | 9 | Real DNS-based SSRF guard with tests — redirect check is post-hoc, no size cap (F-8) |
| 9 | Maintainability | 8.5 | 7.5 | 9 | Version drift *recurred* — the exact bug class fixed in 1.2 (F-4); no CI to stop it |
| 10 | Feature Completeness | 6 | 7 | 9 | Commands, shortcut, status widget, rename |
| 11 | Ecosystem Fit | 5.5 | 7 | 9 | `bulliexplorer-web-search` rename done; still unpublished, no config file |
| | **Overall** | **7.5** | **7.8** | **9+** | |

## Verified done

- **F-1 (v2's critical) properly fixed, twice over**: `SearchCache.clear()` exists and `session_start` mutates the shared instance instead of reassigning; *and* the tool takes `SearchCache | (() => SearchCache)` and resolves it inside `execute()` (tool-search.ts:111). Either alone would have fixed it. ✅
- **SSRF guard is real, not cosmetic**: HTTPS-only, `localhost`/`.localhost` block, DNS resolution via `dns/promises` with all-records check, RFC1918 + loopback + link-local + CGNAT (100.64/10) + 0/8 + TEST-NET-1/3 + benchmark ranges, IPv6 loopback/ULA/link-local incl. v4-mapped unwrapping, applied pre-fetch *and* re-validated on `response.url` after redirects, wired into `web_fetch` and both providers, with a dedicated test file. ✅
- **Phase 5 delivered**: package renamed `bulliexplorer-web-search`; `/websearch`, `/websearch-cache`, `Ctrl+Shift+W` toggle, status widget via `ctx.ui.setWidget` guarded by `ctx.hasUI` — all typecheck against the SDK, README documents them. ✅
- `tsc` clean, `eslint` clean, 125/127 tests pass.

## New findings

**F-4 · Major — version drift recurred.** CHANGELOG's top entry is 0.4.1; `package.json` says 0.4.0. This is the identical bug class fixed in 1.2 (0.3.4-changelog / 0.3.3-package). It recurring within the same day is the strongest possible argument that this is a process problem, not a diligence problem — no human remembers this; a CI check does. Bonus hygiene issue: the "Session cache reset" fix appears verbatim under *both* 0.3.7 and 0.4.0 — one of them didn't happen.

**F-5 · Major — the retry logic cannot retry the errors it lists.** `withRetry(() => fetch(...))` wraps only the `fetch` call, and `fetch` does not throw on HTTP 429/502/503/504 — it resolves with `response.ok === false`. The `if (!response.ok) throw` sits *outside* the retry scope in both providers. So `defaultShouldRetry`'s substring matches for "429"/"502"/"503"/"504" are dead code paths for the providers' own requests: only transport-level failures (ECONNRESET, timeout) ever retry. Additionally, `web_fetch` has zero retry (`withRetry` count in tool-fetch.ts: 0) despite the 0.4.1 changelog claiming it. Fix: a `fetchWithRetry` helper that treats retryable *statuses* as retryable inside the loop (respecting `Retry-After` on 429), used by providers and tool-fetch alike; drop the error-message substring matching, which is brittle by construction.

**F-6 · Major — the new provider tests ship failing.** `providers.test.ts` stubs `globalThis.fetch` but `provider.search()` calls `resolveApiKey()` first — env vars, `.env`, keychain — none of which the test controls. On the author's machine real keys were present, so it passed; in any clean environment (CI, another contributor, this container) both tests fail before the fetch stub is ever reached: 125/127. Fix: inject the key (constructor param or setter) or stub the resolution boundary. This is precisely the failure a CI run on a keyless runner would have caught on commit one —

**F-7 · Major — changelog claims the archive doesn't back.** (a) 0.3.7: "Added a GitHub Actions workflow" — there is no `.github/` directory anywhere in the archive. If it lives in an outer repo, it's not versioned with the code it gates; if not, the claim is false. (b) 0.4.1: retry "for … `web_fetch` requests" — not implemented (F-5). The changelog was the project's best asset in v2; claims-vs-code drift is how that asset dies.

**F-8 · Minor — SSRF residual gaps.** (a) Redirect validation is post-hoc: with `redirect: "follow"`, the request to a blocked target has already *fired* by the time `response.url` is checked — an internal 302 target with side effects is still reachable; proper fix is `redirect: "manual"` with per-hop validation. (b) No response size cap: `response.arrayBuffer()`/`text()` are unbounded — the planned 5 MB cap is still missing. (c) DNS-rebinding TOCTOU: validation resolves the hostname, then `fetch` resolves it again independently; full fix needs resolved-IP pinning (undici Agent) — acceptable to document as a known limitation instead.

**F-9 · Note.** `/websearch` calls the provider directly and neither reads nor populates the session cache — a user running `/websearch foo` then the model searching `foo` pays twice. Cheap alignment win.

## Path to 9+ — reordered by what this round proved

1. **CI, before any further feature work.** Three of five regressions this round (F-4, F-6, F-7a) are CI-catchable, and one (F-6) is CI-*only*-catchable in practice since it needs a keyless environment. Minimum workflow: `npm run check` on a clean runner + a version-consistency step (`node -e` comparing package.json vs. top CHANGELOG heading). Commit it inside this repo.
2. **Fix F-5** (fetchWithRetry with status-aware retry + Retry-After) and **F-6** (key injection) — both small.
3. **Finish fetch hardening**: manual-redirect hop validation + 5 MB size cap (closes F-8a/b), document F-8c.
4. **Phase 3**: Exa zero-config + `auto` fallback chain + config file — the largest remaining parity gap with the benchmark.
5. **Publish** (`pi install npm:bulliexplorer-web-search`).

## Beat-the-benchmark — unchanged, still untouched

The differentiators from v2 remain open and remain the actual "genius" path — nothing this round moved them: query-aware section ranking (~40 LOC BM25-lite, turns fetch into retrieval), context-aware progressive disclosure (summaries + handles when `getContextUsage` says space is tight), and the in-memory content store (`get_search_content`-style exact-offset navigation). pi-web-access still can't retrofit any of these onto char-slicing. But they only pay off on a foundation that doesn't regress — which is why CI moved to #1. Feature velocity this round was high; *verified* velocity is what beats a benchmark.