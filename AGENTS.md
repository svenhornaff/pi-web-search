# AGENTS.md — web-search (pi extension)

## Project overview

`web-search` is a pi coding-agent extension providing two LLM-callable tools — `web_search` (Brave/Tavily) and `web_fetch` (URL → readable content, incl. PDF) — plus user-facing commands and a status widget. TypeScript, no build step (pi loads `.ts` directly via `--experimental-strip-types`).

Workspace layout:

```text
.pi/extensions/
├── package.json          # workspace scripts: typecheck, lint, test, check
├── tsconfig.json
├── eslint.config.mjs
├── hooks/ts-resolve.mjs  # test-runner TS loader
└── web-search/
    ├── package.json      # pi package manifest; version, pi.extensions entry
    ├── CHANGELOG.md
    ├── README.md
    ├── scripts/check-version.mjs
    ├── src/               # extension source — see "Source layout" below
    └── tests/             # node:test files, *.test.ts
```

## Setup

```bash
cd .pi/extensions
npm install
```

Requires `BRAVE_API_KEY` and/or `TAVILY_API_KEY` at runtime (env var, `.env`, or macOS Keychain — see `src/keychain.ts`). Not needed to build, lint, or run the test suite: providers accept an injected key in tests (`src/providers/brave.ts`, `tavily.ts` constructors) instead of resolving one.

## Commands

Run from `.pi/extensions/` (the workspace root — `web-search/`'s own scripts just delegate here):

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint web-search/src/
npm run lint:fix
npm run test        # node --test over web-search/tests/*.test.ts
npm run check       # typecheck + lint + test — run this before considering any change done
```

From inside `web-search/` specifically, `npm run check` additionally runs `check:version` first (`scripts/check-version.mjs`), which fails the build if `package.json`'s version and `CHANGELOG.md`'s top heading disagree. Always run `check` from `web-search/`, not from the parent, so this gate isn't skipped.

## Source layout

- `index.ts` — extension entry point: registers tools, commands, shortcuts, lifecycle hooks. Single most important file for the rule in "Public surface" below.
- `tool-search.ts`, `tool-fetch.ts` — the two registered tools.
- `providers/` — `brave.ts`, `tavily.ts` behind a shared `base.ts` interface, selected via `provider-selector.ts` / `registry.ts`.
- `content-processor.ts`, `pdf-extractor.ts`, `section-parser.ts`, `section-selector.ts`, `structured-extractor.ts` — HTML/PDF → ranked, budget-fit content.
- `token-budget.ts`, `token-counter.ts` — sizing fetched content to the active model's context.
- `safe-fetch.ts`, `ssrf.ts`, `retry.ts` — the hardened outbound-fetch path (SSRF guard, redirect validation, size cap, retry). All arbitrary-URL fetches go through `safeFetch`, not raw `fetch`.
- `keychain.ts`, `search-cache.ts`, `spillover.ts` — key resolution, session cache, disk spillover for oversized responses.

## Code style

- TypeScript strict mode; `tsc --noEmit` must be clean.
- ESLint config in `eslint.config.mjs` governs `web-search/src/` — `npm run lint` must be clean. Tests are not linted.
- No new dependencies without a concrete need — check `package.json`'s existing set (`linkedom`, `turndown`, `pdf-parse`, `js-tiktoken`) before adding one that overlaps.
- Business logic (content processing, budgeting, providers) stays independent of the `pi` SDK types where practical — only `index.ts` and the `tool-*.ts` entry points should import `ExtensionAPI`/`ExtensionContext` directly.

## Testing

- `node:test`, files under `tests/*.test.ts`, run via the workspace's `ts-resolve.mjs` loader.
- New or changed behavior needs a test in the same change — this project has a history of shipping fixes without one.
- Tests must pass with **no API keys in the environment**. Providers take an injected `apiKey` for exactly this reason — use it in tests instead of relying on `resolveApiKey()`.
- Integration-style tests that hit real network/providers do not belong in this suite.

## Public surface — keep it in sync

The public surface is every `pi.registerTool`, `pi.registerCommand`, `pi.registerShortcut`, and `ctx.ui.setWidget` id in `index.ts`, plus every env var and config key the README documents.

This project has shipped regressions where the surface and the docs disagreed — most recently a keyboard shortcut removed from `index.ts` while the README still advertised it. Before treating any change to `index.ts` (or anything it wires up) as done:

- Diff the surface against what it was before the change.
- If something was added, removed, or renamed: update the README section that documents it, add a CHANGELOG entry stating the change explicitly (a removal is stated as a removal, not omitted), and bump `web-search/package.json`'s version.
- If a `tests/surface.test.ts`-style test asserting the registered tool/command/shortcut/widget set exists, update it. If it doesn't exist yet, adding one is the highest-leverage test in this repo — it turns this whole class of drift into a CI failure instead of a later audit finding.

## Changelog conventions

- One entry per behavior change, written when the change is made.
- Every claim must be backed by something in the same commit — don't describe a workflow, a test, or a fix that isn't actually there.
- Past entries are never edited to change their claim. If one turns out wrong, add a short correction blockquote under the *original* entry in the release that fixes it (see the 0.4.1 entry for the pattern) — don't rewrite history.

## Commit and versioning

- `web-search/package.json` version and `CHANGELOG.md`'s top heading must agree — enforced by `check:version`, part of `npm run check`.
- Don't write a CHANGELOG entry for infrastructure (a CI workflow, a script) that isn't committed in the same change.
- `.gitignore` must exclude `node_modules/`, `.DS_Store`, and `.env*` before the first commit that touches this workspace.

## PR / change checklist

1. Code change made.
2. `npm run check` green (from `web-search/`).
3. Public surface diffed (see above) — README and CHANGELOG updated if it changed.
4. Version bumped if `package.json` or `CHANGELOG.md` changed.
5. New/changed behavior has a test that doesn't depend on ambient API keys.