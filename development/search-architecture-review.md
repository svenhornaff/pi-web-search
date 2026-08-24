# Search Architecture Review & Implementation Plan (v1.3.0, Aug 24 2026)

> Scope: the four external services this extension depends on for search and
> content retrieval — Exa, Brave, Tavily, Jina Reader — reviewed against their
> current (Aug 2026) public APIs, plus one independent third-party benchmark.
> Every claim below cites what was actually found; nothing is inferred from
> training-data memory of these APIs, since all four have shipped material
> changes since any model's cutoff.
>
> This is a **provider-integration and content-strategy** review, not a
> restatement of the open code-correctness items in `phased-refactor-plan.md`
> — those stand independently and aren't repeated here.

---

## Current architecture snapshot

```
web_search ──▶ suggestProvider() heuristic ──▶ ProviderRegistry.searchWithFallback()
                                                  ├─ ExaProvider    (POST api.exa.ai/search)
                                                  ├─ BraveProvider  (GET api.search.brave.com/res/v1/web/search)
                                                  └─ TavilyProvider (POST api.tavily.com/search)

web_fetch  ──▶ safeFetch() ──▶ extractMarkdown() ──▶ [empty?] ──▶ RSC parser ──▶ [still empty?] ──▶ Jina Reader (r.jina.ai, unauthenticated)
                                                                                                    └─▶ section ranking/selection ──▶ ContentStore (if truncated)
```

Three independent search providers behind a fallback chain, one content-extraction pipeline with two escalating fallbacks for JS-rendered pages. This is a sound shape — the finding below is that each of the four external integrations is using an older or narrower slice of its provider's current API than what's now available, and one architectural option (a provider-native answer endpoint) directly addresses an open item from the correctness review.

---

## Finding 1 — Exa: using `text` mode where the vendor now recommends `highlights`

**Current implementation** (`providers/exa.ts`):
```ts
contents: {
  text: { maxCharacters: 3000 },
}
```

**What Exa's current docs say** (`exa.ai/docs/reference/search-api-guide-for-coding-agents`, and `docs.exa.ai/reference/search`, both fetched live):

> "Use highlights over text for agent workflows. Highlights return 10x fewer tokens with the most relevant excerpts... Prefer highlights: true for the highest-quality default."

Highlights are also described as the retrieval substrate inside Exa's *own* agentic endpoints (`/answer`, Deep, Websets) — "every iteration of those agent loops reads highlights, not raw page content" (Exa engineering blog, `exa.ai/blog/highlights-for-agents`). This isn't a minor parameter tweak; it's the vendor's own stated best practice for exactly this extension's use case (an LLM agent consuming search results), and it directly serves this project's own stated differentiator — token-aware content delivery.

**Change:**
```ts
contents: {
  highlights: { numSentences: 5, highlightsPerUrl: 3 },  // tune against real queries
  // text kept as a fallback field, not the primary content source, if highlights come back empty
}
```
Requesting both `text` and `highlights` in the same call is supported ("You can request text, highlights, and summary in the same call — all nested un[der contents]") — so this can be additive rather than a breaking swap: prefer `highlights` for `fullContent`, fall back to the existing `text` truncation only if a result has no highlights.

**Also found:** the current provider authenticates with `"x-api-key": this.apiKey`. Exa's primary documented pattern is now `Authorization: Bearer $EXA_API_KEY`; `x-api-key` still appears in some third-party integration guides, so this is *not* confirmed broken — but it's worth a direct confirmation against a live call before assuming both remain supported indefinitely, rather than carrying it forward on the assumption that it still works because it worked when this was written.

---

## Finding 2 — Brave: not using the endpoint Brave now says is "the most powerful Search API for AI"

**Current implementation:** `GET /res/v1/web/search` — the raw SERP endpoint, same as when this provider was first written.

**What's now available** (Brave's own API docs, fetched live, `api-dashboard.search.brave.com`):

> "Looking to power agents or chatbots? Use the LLM Context endpoint instead. The LLM Context endpoint is specifically built for machine consumption, and benchmarked as the most powerful Search API for AI."

Brave's current endpoint map:
| Endpoint | Purpose |
|---|---|
| `GET /res/v1/web/search` | Ranked web results and snippets — what's implemented today |
| `GET/POST /res/v1/llm/context` | Retrieval output shaped for model consumption |
| `POST /res/v1/chat/completions` | Grounded answer generation, streaming, citations — OpenAI-compatible chat format |

**This directly addresses an open item from `phased-refactor-plan.md` Phase 2.3** ("answer mode doesn't use the prompt for extraction" — it's currently a cosmetic preamble, not real prompt-aware retrieval). Rather than building a hand-rolled lexical-ranking boost as that plan sketched, `web_fetch`'s `mode: "answer"` could call Brave's `/res/v1/chat/completions` directly when a Brave key is configured — a real grounded-answer endpoint with citation support, maintained by the provider, instead of a homegrown approximation. This is worth weighing as an alternative to that plan's original 2.3 fix, not an addition to it — pick one, not both, to avoid two competing "answer" code paths.

**Change (search path):** evaluate `/res/v1/llm/context` as a drop-in replacement for `/res/v1/web/search` in `BraveProvider.search()` — same auth header (`X-Subscription-Token`), machine-shaped output that likely needs less client-side reformatting in `format.ts`.

**Change (answer mode):** route `tool-fetch.ts`'s `mode: "answer"` through Brave's `/res/v1/chat/completions` when available, with the current section-ranking approach as the fallback when no Brave key is configured (so answer mode still degrades gracefully rather than hard-requiring a specific provider).

---

## Finding 3 — Tavily: `/extract` is a viable second `web_fetch` fallback, reducing single-vendor risk on the JS-render path

**Current implementation:** `web_fetch`'s only fallback for JS-rendered/cookie-walled pages is Jina Reader — one external, unauthenticated, unrelated-vendor dependency for the entire "standard extraction failed" path.

**What's now available:** Tavily has expanded from a search-only API to four endpoints — `search`, `extract`, `crawl`, `map` — with `/extract` doing exactly what Jina's Reader does: "Clean content from one or more URLs (markdown or text), optional images, advanced depth for tables/embedded data" (Tavily's own docs, `docs.tavily.com`, fetched live).

**Why this matters architecturally, not just as a feature add:** the project already holds a Tavily API key (it's provider #2 in the fallback chain) and already has `resolveApiKey()` wired for it. Adding `/extract` as a fetch fallback costs no new credential surface — it's the same key, a different endpoint. Compare that to Jina, which is:
- Called **unauthenticated** — no `JINA_API_KEY` support anywhere in `keychain.ts` or `content-processor.ts` — which caps the fallback path at Jina's free-tier rate limit (~20 requests/minute per current third-party pricing reviews; this project has no monitoring or budget-awareness for that limit at all).
- A **separate vendor relationship** for a capability the extension already pays for elsewhere.

**Change:** add `fetchViaTavily(url)` alongside `fetchViaJina(url)` in `content-processor.ts`'s fallback chain, tried first (since it's already-authenticated and already-paid-for), with Jina remaining as the final fallback rather than being removed outright — Jina's zero-key entry point is still valuable for a first-run experience where only a Brave key is configured.

```ts
// Step 1c: content-fallback chain, cheapest/already-configured first
if (tokenEstimateAfterRsc < MIN_CONTENT_TOKENS) {
  const tavilyMarkdown = await fetchViaTavilyExtract(url); // NEW — reuses existing key
  if (tavilyMarkdown && betterThan(tavilyMarkdown, markdown)) markdown = tavilyMarkdown;
  else {
    const jinaMarkdown = await fetchViaJina(url); // existing, now second-in-line
    if (jinaMarkdown && betterThan(jinaMarkdown, markdown)) markdown = jinaMarkdown;
  }
}
```

**Separately, a smaller finding in the same file:** `TavilyProvider.search()` sends `api_key` inside the JSON request body rather than as a header. Current Tavily integration examples (official SDKs, third-party gateways) consistently show `Authorization: Bearer $TAVILY_API_KEY`. Body-embedded credentials are more likely to end up in request logs on any intermediate proxy than header-embedded ones. Not confirmed broken — Tavily's `/search` almost certainly still accepts the legacy body form — but worth migrating to header auth on the next touch of this file, for the same reason header-based auth is generally preferred over body-based.

---

## Finding 4 — Jina dependency risk: single vendor, unauthenticated, and recently acquired

Three separate facts compound here, each individually minor:

1. **Jina AI was acquired by Elastic in October 2025.** Current reviews (mid-2026) note the standalone Reader API "remain[s] available... but expect Jina's standalone identity to fade over time" as it's folded into Elasticsearch's ML tooling.
2. **The extension calls `r.jina.ai` with no API key** — confirmed in `content-processor.ts`: `"https://r.jina.ai/<url> returns clean markdown, no API key needed."` This caps throughput at Jina's free, unauthenticated rate tier.
3. **It's the sole fallback for the entire JS-rendered/cookie-wall extraction path** until Finding 3's change lands — if Jina's free tier changes terms or throughput post-acquisition, `web_fetch` silently degrades on every page that needs this path, with no alternative.

**Note, for balance:** Tavily itself isn't risk-free either — it was acquired by Nebius for $275M in February 2026, and is now a Nebius subsidiary. This doesn't change Finding 3's recommendation (adding Tavily Extract still reduces *concentration* risk by turning one single point of failure into two independent-enough paths), but it means "add a second vendor" is risk *reduction*, not risk *elimination* — both remaining vendors have recently changed ownership.

**Change:** support an optional `JINA_API_KEY` in `keychain.ts` alongside the other three (same pattern, same resolution order), so throughput isn't capped at the free tier once Finding 3's Tavily-first ordering is in place and Jina becomes the genuine last resort rather than the only option.

---

## External signal: independent benchmark data on provider quality

AIMultiple's 2026 agentic-search benchmark (`aimultiple.com/agentic-search`, fetched live) scored 8 search APIs across 100 real-world AI/LLM queries and 4,000 retrieved results, using an LLM judge for relevance/quality/noise across 6 categories:

> "Brave Search leads with 14.89... Only one clear winner: Brave consistently outperformed Tavily by about 1 point, a gap large enough to be meaningful rather than random chance." Firecrawl, Exa, and Parallel Search Pro were statistically tied just behind Brave.

**What this does and doesn't imply for this project:** it's a general-purpose benchmark, not query-category-specific — it doesn't invalidate `provider-selector.ts`'s heuristic routing (Exa for semantic/research queries, Tavily for deep-dive/comparison queries, Brave for time-sensitive queries), which is a *more* targeted strategy than "pick one winner." What it does suggest: the current `DEFAULTS.fallbackOrder` in `config.ts` — `["exa", "brave", "tavily"]` — puts Exa ahead of Brave as the generic fallback-after-primary-fails order, even though this specific benchmark found Brave outperforming both Exa and Tavily on average, with Tavily specifically trailing by a meaningful margin.

**Change:** reconsider the default `fallbackOrder` to `["brave", "exa", "tavily"]` — Brave first as the strongest general-purpose fallback per this benchmark, Exa second for when Brave itself fails (still valuable for its semantic strengths), Tavily last. This is a config *default* change only — `suggestProvider()`'s category-based *primary* selection is unaffected and remains the more sophisticated first choice; this only changes what happens after the primary choice fails.

---

## Rejected option, noted for completeness: routing through providers' official MCP servers

Both Exa (`mcp.exa.ai/mcp`) and Tavily (`mcp.tavily.com/mcp`) now ship official hosted MCP servers, and this came up repeatedly in the research for this review. **Not recommended here.** This extension *is* an MCP-adjacent tool provider for the Pi agent — its job is to expose `web_search`/`web_fetch`/`get_fetch_content` as tools *to* Pi, not to act as an MCP *client* chaining into other services' MCP servers. Adding that indirection would mean every search call hops through an extra protocol layer, an extra network round-trip, and an extra point of failure, for a project whose entire design principle (per its own README's "Non-Goals"-style leanness framing) is staying close to plain `fetch()` calls it fully controls. Direct REST integration, as already built, remains the right choice — noted here so this option is documented as considered, not overlooked.

---

## Phased implementation plan

### Phase A — Exa: switch to `highlights`, verify auth header
- Add `highlights` to the `contents` request object in `exa.ts`, keep `text` as fallback field
- Update response parsing to prefer `highlights` content over `text` for `fullContent`
- Confirm `Authorization: Bearer` vs `x-api-key` against a live call; update if the vendor has deprecated the latter
- Update the file's header-comment "Docs:" link and pricing notes, which still reference the pre-highlights integration
- Test: assert `fullContent` token count drops materially on a fixed query set (this is a measurable, not just qualitative, validation of the "10x fewer tokens" claim)

### Phase B — Brave: LLM Context endpoint + real answer mode
- Prototype `/res/v1/llm/context` against `/res/v1/web/search` on the same query set; compare `format.ts` output quality and size
- If it wins, swap `BRAVE_SEARCH_URL` and adjust response parsing (same auth header, different response shape)
- Decide the answer-mode approach: Brave `/res/v1/chat/completions` vs the phased-refactor-plan's original prompt-aware section-ranking — implement one, not both
- If Brave-answers is chosen: `applyAnswerMode()` in `tool-fetch.ts` becomes conditional — real grounded answer when a Brave key exists, current section-ranking fallback otherwise (keeps answer mode functional for Exa/Tavily-only setups)

### Phase C — Content-fetch fallback diversification
- Implement `fetchViaTavilyExtract(url)` in `content-processor.ts`, reusing the existing `TavilyProvider`'s key resolution
- Reorder the fallback chain: RSC parser → Tavily Extract → Jina Reader (was: RSC → Jina only)
- Add `JINA_API_KEY` support to `keychain.ts` (same `KeychainConfig` pattern as the other three) so Jina isn't capped at its unauthenticated rate tier once it's the true last resort
- Update the stale `User-Agent: pi-web-search/0.8` string in `fetchViaJina()` to track the real version, or better, derive it from `package.json` at build time so it can't drift again

### Phase D — Fallback-order default tuning
- Change `config.ts`'s `DEFAULTS.fallbackOrder` from `["exa", "brave", "tavily"]` to `["brave", "exa", "tavily"]`
- Update the README's config example and field-reference table to match
- No change to `provider-selector.ts` — category-based primary selection stays as-is

### Phase E — Auth hygiene pass
- Migrate `TavilyProvider` from body-embedded `api_key` to `Authorization: Bearer` header, verified against a live call first
- Bundle with Phase A's Exa auth-header confirmation — both are "confirm current vendor auth convention, migrate if changed" tasks and touch the same file pattern

---

## Sequencing

| Phase | Depends on | Risk if skipped |
|---|---|---|
| A (Exa highlights) | — | Extension keeps paying ~10x the token cost Exa's own docs say is avoidable — directly undercuts this project's stated token-budgeting differentiator |
| B (Brave LLM Context + answer mode) | Decision on answer-mode approach (don't build both) | `answer` mode stays cosmetic indefinitely; search quality left on the table |
| C (Tavily Extract fallback) | Reuses existing Tavily key — no new dependency | Single-vendor, unauthenticated, rate-capped path remains the only JS-render fallback |
| D (fallback order) | Independent of A–C | Minor — current order still returns results, just not benchmark-optimal on fallback |
| E (auth hygiene) | Can ride along with A | Low urgency — no confirmed breakage, just not best-practice |

A is the highest-leverage single change here: it's a same-file, same-endpoint parameter change that directly reduces token cost on every search call that uses Exa, with the vendor's own documentation as the justification. Start there.