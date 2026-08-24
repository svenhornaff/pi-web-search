# web-search

Dual-provider web search and content extraction extension for the [Pi coding agent](https://pi.dev).

The model **autonomously decides** when to search — no `/skill:` invocation needed. Ask *"what changed in FastAPI 0.110?"* and the agent calls `web_search` automatically.

## Tools

| Tool | What it does |
|------|-------------|
| `web_search` | Search via Exa, Brave, or Tavily. Provider auto-selected. Supports `queries[]` for parallel multi-angle research with deduplication. |
| `web_fetch` | Fetch a URL → clean markdown. GitHub URLs routed to raw/API. JS-rendered pages fall back to Jina Reader. Token-budget aware. |

## Provider Design

| | Exa | Brave | Tavily |
|-|-----|-------|--------|
| **Search type** | Neural / semantic | Contextual SERP | AI-native keyword |
| **Best for** | AI/research/conceptual | News, releases | Deep research, comparisons |
| **Result content** | Title + snippet + **full page text** | Title + snippet only | Title + snippet + **full page content** |
| **AI summary** | No | No | Yes — prepended to first result |
| **Freshness filter** | `day / week / month / year` | `day / week / month / year` | — |
| **Search depth** | — | — | `basic` (1 credit) · `advanced` (2 credits) |
| **Free tier** | 1000 searches/month | $5/month (~1000 queries) | 1000 credits/month |
| **`web_fetch` cost** | $0 (plain HTTP GET) | $0 (plain HTTP GET) | $0 (plain HTTP GET) |
| **Key env var** | `EXA_API_KEY` | `BRAVE_API_KEY` | `TAVILY_API_KEY` |

**Rule**: `web_fetch` always uses a plain HTTP GET regardless of which provider was used for the preceding search.

**Auto-selection heuristics:** Exa → AI/ML/research/conceptual · Tavily → comparisons/guides · Brave → time-sensitive/news · Brave → default fallback.

## Distribution

This package is published as `@svenhornaff/web-search` and can be installed via Pi with:

```bash
pi install npm:@svenhornaff/web-search
```

The extension also registers user-facing commands and a shortcut:

- `/websearch <query>` — run a quick search or show status (shares the session cache with `web_search`)
- `/websearch-cache` — inspect the active session cache size

The status widget is always visible (no toggle needed).

## Security

Every outbound fetch to an arbitrary (model- or user-supplied) URL — `web_fetch`
and `BraveProvider.fetch()` — goes through `src/safe-fetch.ts`:

- **HTTPS only.** Non-`https://` schemes are rejected at the TypeBox schema
  layer and again in `validateFetchUrl()`.
- **SSRF guard** (`src/ssrf.ts`): blocks `localhost`/`.localhost`, and
  resolves the hostname via DNS to check *every* returned address against
  RFC1918, loopback, link-local, CGNAT (100.64/10), 0/8, TEST-NET-1/3,
  benchmark ranges, and the IPv6 equivalents (loopback, ULA, link-local,
  including `::ffff:`-mapped IPv4).
- **Per-hop redirect validation.** Fetches use `redirect: "manual"`, and
  each redirect target is re-validated through `validateFetchUrl()` *before*
  that hop's request fires (capped at 5 hops). This replaced a post-hoc
  check of `response.url` after `redirect: "follow"` — by the time you can
  inspect `response.url`, the blocked hop's request has already gone out.
- **5 MB response cap**, enforced via `Content-Length` when present and by
  aborting the stream mid-read otherwise (a server can omit or lie about
  `Content-Length`).
- **Retry with backoff**, status-aware: `fetchWithRetry()` (`src/retry.ts`)
  retries HTTP 429/502/503/504 in-loop (honoring `Retry-After`, seconds or
  HTTP-date) as well as transport-level failures (ECONNRESET, timeouts).

**Known limitation — DNS-rebinding TOCTOU.** `validateFetchUrl()` resolves
the hostname to check it, then `fetch()` resolves it again independently a
moment later. A DNS answer that changes between those two lookups (classic
DNS rebinding) is not caught by this guard. A full fix needs resolved-IP
pinning — e.g. a custom undici `Agent` that fetches the exact IP address
`validateFetchUrl()` already validated — which is a larger change than the
guard's current design. Documented here rather than silently unhandled;
every non-rebinding SSRF path (direct requests, redirects, IP-literal
targets, IPv6 variants) is covered.

## Configuration

Create `~/.pi/web-search.json` (or `$PI_CODING_AGENT_DIR/web-search.json`) to
customise behaviour. All fields are optional — omitted fields use built-in
defaults. `$ENV_VAR` references in values are interpolated at load time.

```json
{
  "defaultProvider": "auto",
  "fallbackOrder": ["exa", "brave", "tavily"],
  "maxResults": 5,
  "maxInlineContentChars": 30000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `defaultProvider` | `"auto"` \| `"exa"` \| `"brave"` \| `"tavily"` | `"auto"` | Provider used when the model doesn’t specify one. `auto` = heuristic selection. |
| `fallbackOrder` | `string[]` | `["exa","brave","tavily"]` | Providers tried in order when the primary fails (missing key, error). Explicit `provider:` params bypass fallback. |
| `maxResults` | number (1–20) | `5` | Default result count. |
| `maxInlineContentChars` | number (≥1000) | `30000` | Max characters returned inline by `web_fetch` before spillover. |

Config is reloaded on every `session_start` — edit the file and run `/reload`
to pick up changes without restarting Pi.

## Setup

### Exa API key (recommended — best for AI/research)

Register at <https://dashboard.exa.ai> — 1000 free searches/month.

**macOS:**
```bash
security add-generic-password -a "$USER" -s "exa-api-key" -w "YOUR_KEY" -U
```
**Any platform:**
```bash
export EXA_API_KEY="YOUR_KEY"
```

### Brave Search API key (recommended for news/time-sensitive)

Register at <https://api-dashboard.search.brave.com/register> — free $5/month credit.

**macOS:**
```bash
security add-generic-password -a "$USER" -s "brave-api-key" -w "BSA..." -U
```
**Any platform:**
```bash
export BRAVE_API_KEY="BSA..."
```

### Tavily API key (recommended for deep research)

Register at <https://tavily.com> — 1000 free credits/month.

**macOS:**
```bash
security add-generic-password -a "$USER" -s "tavily-api-key" -w "tvly-..." -U
```
**Any platform:**
```bash
export TAVILY_API_KEY="tvly-..."
```

### Key resolution order

1. macOS Keychain (macOS only — skipped on other platforms)
2. Environment variable (`EXA_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`)
3. Workspace `.env` file

> At least one key is required. The fallback chain tries all configured providers automatically.

### Install

```bash
cd .pi/extensions/web-search && npm install
# then in Pi:
/reload
```

## Parameters

### `web_search`

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `query` | string | — | 3–6 words recommended |
| `max_results` | number | 5 | 1–20 |
| `provider` | `exa` \| `brave` \| `tavily` | auto | |
| `freshness` | `day` \| `week` \| `month` \| `year` | — | Brave + Exa |
| `depth` | `basic` \| `advanced` | `basic` | Tavily only |

### `web_fetch`

| Parameter | Type | Notes |
|-----------|------|-------|
| `url` | string | Must include `https://` |

## Token budgeting

The extension tracks the active model via the `model_select` event. The platform provides `contextWindow`, `maxTokens`, and `provider` directly — no hardcoded model table.

### Static budget (per-model)

```
maxContentTokens = (contextWindow − maxTokens − 5% tool reserve) × 95%
```

Before `model_select` fires (e.g. at cold startup), a conservative 100K-context fallback is used.

### Dynamic budget (per-fetch, session-aware)

Each `web_fetch` call checks the session's current context usage via `ctx.getContextUsage()` and reduces the content budget accordingly:

```
effectiveBudget = min(staticBudget, contextWindow − usedTokens − outputReserve)
```

This prevents stuffing 750K of web content into a session that has already consumed 900K of its 1M context window.

### Token counting

| Strategy | When used |
|----------|-----------|
| `js-tiktoken` (offline) | OpenAI-compatible models |
| Heuristic (chars ÷ 3–4) | Anthropic, Google, and all others |

All counting is local — no network calls. The heuristic is accurate enough for section-selection budgeting.

When fetched content exceeds budget, sections are ranked by importance and the highest-ranked subset is returned. The full content is saved to `.pi/cache/web-fetch/` with a 24-hour TTL and its path is included in the response so the model can request specific sections.

### Section ranking

Sections are scored and selected greedily to fill the token budget:

- **Boosted**: introduction, API reference, examples, tutorial, installation; code-heavy sections; sections containing tables
- **Penalised**: footer, navigation, sidebar, comments, advertisement; sections under 50 tokens

## Architecture

```
src/
├── index.ts              — Extension factory: model tracking, cache + config lifecycle, tool registration
├── config.ts             — JSON config loader (~/.pi/web-search.json), $ENV_VAR interpolation, soft-fail
├── tool-search.ts        — web_search tool definition + execute
├── tool-fetch.ts         — web_fetch tool definition + execute (dynamic budget via ctx.getContextUsage())
├── format.ts             — formatSearchResults(), buildFetchResponse()
├── types.ts              — Shared TypeScript interfaces
├── token-budget.ts       — buildBudget() + effectiveContentBudget() — pure ratio math, no hardcoded models
├── token-counter.ts      — Two-tier counting: js-tiktoken (OpenAI) / heuristic (all others)
├── content-extractor.ts  — HTML → clean markdown (linkedom + Turndown + GFM)
├── section-parser.ts     — Markdown section parsing and importance ranking
├── section-selector.ts   — Shared greedy section selection within token budget
├── content-processor.ts  — HTML extraction pipeline orchestration
├── pdf-extractor.ts      — PDF text extraction (pdf-parse)
├── spillover.ts          — Spillover cache (write + TTL cleanup, cwd-aware)
├── keychain.ts           — Cross-platform key resolution: Keychain (macOS) / env var / .env
├── ssrf.ts               — validateFetchUrl(): HTTPS-only + private/loopback network guard
├── safe-fetch.ts         — safeFetch(): per-hop redirect validation + 5 MB response cap
├── retry.ts              — fetchWithRetry(): status-aware retry (429/5xx + transport errors)
├── search-cache.ts       — In-memory search result cache (reset on session_start)
├── search-aggregator.ts  — Multi-provider result deduplication and ranking
├── provider-selector.ts  — Automatic provider selection heuristics
├── github-handler.ts     — GitHub URL routing: blob→raw, tree→API listing, root→README+tree
├── structured-extractor.ts — JSON-LD / OpenGraph / meta extraction
└── providers/
    ├── base.ts           — SearchProvider interface
    ├── brave.ts          — Brave Search (contextual, freshness filters)
    ├── tavily.ts         — Tavily Search (keyword, full content)
    ├── exa.ts            — Exa Search (neural semantic, fullContent, freshness)
    ├── registry.ts       — Provider registry, fallback chain, parallel search
    └── index.ts          — Re-exports
```

## Development

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
npm run lint:fix     # eslint src/ --fix
npm run test         # node --test (140 tests)
npm run check:version # package.json version must match CHANGELOG.md's top entry
npm run check        # check:version + typecheck + lint + test
```

CI runs the same checks on every push/PR that touches this extension —
`.github/workflows/pi-web-search-check.yml`.

Quick test without installing:

```bash
pi -e ./src/index.ts
```

## License

Non-Commercial Source-Available License (NCSAL) — see [LICENSE](../../../../LICENSE) in the repository root.

Commercial use requires written permission from the author. See [sven.hornaff@gmail.com](mailto:sven.hornaff@gmail.com).
