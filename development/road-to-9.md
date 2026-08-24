# Road to 9+ — Refactor Plan (v1.5.0, Aug 24 2026)

> Current: **8.4 overall** (extension code 8.7, project foundation 8.0).
> Every item from `phased-refactor-plan.md` and `search-architecture-review.md`
> is implemented and independently verified — this plan is what's *left*, not
> what's broken. Nothing below is a defect in shipped behavior; each item is
> the specific remaining distance between a category's current score and 9+,
> stated with the evidence for why it's still open.
>
> Honest framing up front: 8.4 → 9+ is not one big feature. It's the last
> half-point in six different categories, plus actually shipping. The items
> are ordered by leverage-per-effort, not by category.

---

## Current scores and the specific gap in each

| Area | Now | Gap to 9+ |
|---|:---:|---|
| Product concept | 8.5 | Differentiators exist (prompt-aware ranking, ContentStore, dynamic budgets) but aren't measured — no benchmark evidence they beat the naive alternative |
| Architecture | 9 | At target. Guard it, don't grow it |
| Code quality | 8.5 | Per-call singleton mutation for `defaultProvider`; stale in-code comments that describe pre-fix behavior |
| Content extraction | 9 | At target |
| Provider strategy | 9 | At target |
| Security | 8.5 | DNS-rebinding TOCTOU — the one documented-not-fixed item, needs resolved-IP pinning |
| Reliability | 8.5 | Rate-limiter `acquire()` can't be aborted; `web_search` output has per-result char caps but no total token budget |
| Testing | 9 | At target for correctness; no coverage *visibility*, no live contract tests |
| Documentation | 8 | Three-way `fallbackOrder` example drift; stale `applyAnswerMode` comment — and no *mechanism* preventing recurrence |
| CI/CD | 8 | Coverage reporting and CodeQL (both explicitly deferred earlier); no release automation |
| npm packaging | 8.5 | Proven correct, never published — `pi install npm:@svenhornaff/web-search` still resolves to nothing |
| Governance | 7.5 | All 12 versions tagged (good); but direct pushes to `develop` remain the actual workflow — the protected `main` + PR flow exists and isn't used |
| Repo hygiene | 8.5 | `.gitignore` lacks `__pycache__`/`*.pyc` — the incident is cleaned up but not prevented |

---

## Phase 1 — Ship it (npm packaging 8.5 → 9.5, Governance 7.5 → 8)

The single largest gap between "excellent repo" and "excellent project" is that
nobody can install this. Packaging has been smoke-tested in CI since v1.1.0 and
independently re-verified twice — the remaining step is purely the release act.

### 1.1 Publish to npm
- `npm publish --access public` from a tagged commit. Scope `@svenhornaff` is confirmed free.
- Update the root README and extension README install instructions from the
  local-path flow to `pi install npm:@svenhornaff/web-search` as the primary path
  (keep the local flow as the contributor path).

### 1.2 Release automation, so 1.1 never happens by hand again
- GitHub Actions workflow triggered on `v*` tags: run the full check, then
  `npm publish` with an `NPM_TOKEN` repo secret and provenance
  (`npm publish --provenance`) so consumers can verify the tarball came from
  this repo's CI, not a laptop.
- Generate the GitHub Release body from the CHANGELOG entry for that version —
  the CHANGELOG is already release-quality; stop leaving it repo-only.

### 1.3 Use the branch flow that already exists
- `main` is protected with a required status check — but the working pattern is
  still direct pushes to `develop` and occasional fast-forwards. Switch to:
  feature work on `develop` (or short-lived branches), PR into `main`, release
  tags cut from `main`. The protection is only worth its setup cost if merges
  actually pass through it.

---

## Phase 2 — Doc consistency as a *mechanism*, not a cleanup (Documentation 8 → 9)

The project has now re-fixed claims-vs-code drift at least four separate times
(CHANGELOG false claims in 0.4.x, README config semantics in 1.0.x, the
`maxInlineContentChars` description in 1.4.0, and now the `fallbackOrder`
examples in 1.5.0). Each fix was correct; the pattern is the finding. The
version-consistency gate killed one drift class permanently — do the same here.

### 2.1 Fix the current three instances
- `config.ts` header JSDoc example: `["brave", "tavily"]` → the real default
  `["brave", "exa", "tavily"]`.
- README config example: `["exa", "brave", "tavily"]` → same.
- `tool-fetch.ts` lines ~54–55: the `applyAnswerMode` comment still says
  "Section ranking already surfaces the best content; answer mode just reframes
  the output" — that described the *pre-v1.2.0* behavior. Ranking has been
  prompt-aware (`promptHint` lexical boost) since 2.3 was fixed; the comment
  above the function that benefits from it says otherwise.

### 2.2 Make examples test-enforced
- New `tests/doc-consistency.test.ts`: parse the fenced JSON example out of the
  README's Configuration section and out of `config.ts`'s header comment, and
  assert both deep-equal `DEFAULTS` (for the fields they show). Same pattern as
  `check-version.mjs` and `surface.test.ts` — this class of drift becomes a CI
  failure instead of a review finding. This is the highest-leverage single item
  in this plan relative to its size (~40 LOC of test).

---

## Phase 3 — The last security item (Security 8.5 → 9.5)

### 3.1 DNS-rebinding TOCTOU: resolved-IP pinning
The one gap `ssrf.ts` has documented since v0.5.0 rather than fixed:
`validateFetchUrl()` resolves and validates the hostname, then `fetch()`
resolves it again independently — a DNS answer that changes between the two
lookups bypasses the guard.

**Fix:** have `validateFetchUrl()` return the validated IP alongside the URL,
and give `safeFetch()` a custom undici `Agent` whose `connect` callback dials
the *validated address* while sending the original hostname for SNI/Host. The
per-hop redirect loop already re-validates each target, so the pinning slots in
at exactly one place.

```ts
import { Agent } from "undici";

function pinnedAgent(validatedIp: string, hostname: string): Agent {
  return new Agent({
    connect: { lookup: (host, _opts, cb) => cb(null, [{ address: validatedIp, family: isIP(validatedIp) }]) },
  });
}
```

- Node's global `fetch` accepts a `dispatcher` option per-request (undici) —
  no global agent mutation needed.
- Tests: stub `dns/promises.lookup` to return a public IP on validation and a
  private IP on a second call — assert the request still goes to the first
  (pinned) address. That test is the whole point: it proves the TOCTOU window
  is closed, not narrowed.
- Update the README's known-limitation section from "documented, not fixed" to
  fixed — and delete the limitation note from `safe-fetch.ts`'s header. (Phase
  2.2's lesson applies: a fix that leaves the old caveat in place creates the
  next doc-drift finding.)

---

## Phase 4 — Reliability polish (Reliability 8.5 → 9)

### 4.1 Abort propagation through the rate limiter
`RateLimiter.acquire()` takes no `AbortSignal` — a queued caller whose request
was cancelled still waits out the queue and then fires nothing (or worse,
fires anyway depending on the caller's check placement). Every provider
`search()` already threads a `signal`; the limiter is the one link in the chain
that ignores it.

**Fix:** `acquire(signal?: AbortSignal)` — reject immediately if already
aborted, and remove the queued resolver on an `abort` event. Add a test that
queues two acquires, aborts the second, and asserts it rejects without waiting
for the first's interval.

### 4.2 Total output budget for `web_search`
`maxInlineContentChars` caps `fullContent` *per result*; nothing caps the
total. Five Tavily/Exa results at the 30K default is a ~150K-char tool response
— `web_fetch` would never do that (it has token-budgeted section selection),
but `web_search` can. The model-budget machinery already exists and is already
injected into `tool-fetch`.

**Fix:** thread the same `() => budget` getter into `createSearchTool()` and
cap the *sum* of inline `fullContent` across results at a fraction of
`maxContentTokens` (chars ÷ 4 heuristic is fine — this is a guardrail, not
accounting). When the cap trims a result's content, append the same
"[...truncated — use web_fetch for full content]" marker the per-result cap
already uses. Regression test with 5 long-content results asserting total
output size stays under the cap.

---

## Phase 5 — Visibility and small hygiene (Testing 9 → 9.5, CI/CD 8 → 9, Repo hygiene 8.5 → 9)

### 5.1 Coverage reporting (visibility, not a gate)
`node --test` supports `--experimental-test-coverage` natively — no new
dependency. Add a CI step that prints the summary and uploads the report as an
artifact. Don't gate on a threshold yet; the value is seeing which of the 33
src files have no test touching them, the same visibility that would have
surfaced the truncated-content-store bug earlier. Gate later if the number
stabilizes.

### 5.2 CodeQL
The default JavaScript/TypeScript CodeQL workflow, as its own action. Near-zero
maintenance; closes the "static analysis: none" line that's been carried as
explicitly-deferred since Phase 5.2 of the last plan.

### 5.3 Opt-in live contract tests
One small test file, skipped unless real keys are present
(`process.env.LIVE_CONTRACT_TESTS`), that fires one real request per provider
and asserts only the response *shape* (not content). Catches the failure mode
none of the 281 mocked tests can: a provider changing its actual API out from
under the stubs — which is exactly what the search-architecture review found
had happened (Brave's endpoint map, Exa's content modes) via docs rather than
via a failing test. Run weekly on a schedule trigger, not per-push.

### 5.4 Close the `.gitignore` gap
`__pycache__/`, `*.pyc`, `*.pyo` — three lines. The Python-scaffold incident is
cleaned up; this makes it non-repeatable. Bundle with any Phase 2 commit.

### 5.5 `defaultProvider` without global mutation
`tool-search.ts` calls `registry.setDefaultProvider()` inside `execute()` —
mutating shared singleton state on every call to express what is really a
per-call read of config. Works today (single session, single config), but it's
the same shape as the F-1 closure bug and the singleton test-isolation issue:
shared mutable state where a parameter would do. Pass the resolved default into
the provider-selection expression instead; delete the mutation. Small, and it
removes the last "mutate a global to communicate" pattern in the codebase.

---

## Explicitly not in this plan

- **New providers, new tools, new modes.** Feature surface is at parity-or-better
  with the benchmark on everything this project chose to compete on. More
  breadth from here dilutes the leanness that is the pitch.
- **Observability infrastructure.** Assessed and dropped from the rating in the
  last review — a debug flag remains a "when someone asks" item, not a 9-blocker.
- **A docs site.** README + CHANGELOG + `development/` render fine on GitHub at
  this project's size; revisit only if the API surface outgrows flat Markdown.

---

## Sequencing and expected movement

| Order | Phase | Effort | Moves |
|---|---|---|---|
| 1 | 2 (doc mechanism) | Small | Documentation 8 → 9, and retires a recurring finding class permanently |
| 2 | 1 (publish + release automation + branch flow) | Small–medium | npm 8.5 → 9.5, Governance 7.5 → 8.5 |
| 3 | 4 (abort + output budget) | Medium | Reliability 8.5 → 9 |
| 4 | 3 (IP pinning) | Medium | Security 8.5 → 9.5 |
| 5 | 5 (coverage, CodeQL, contract tests, hygiene, singleton cleanup) | Small each | Testing 9 → 9.5, CI/CD 8 → 9, Code quality 8.5 → 9 |

All five phases landed and verified puts the weighted overall at **~9.1** —
with the two remaining sub-9 categories (Product concept's unmeasured
differentiators, Governance's actual-PR-flow habit) being things that only time
and usage move, not commits.