# pi-web-search

A [Pi coding agent](https://pi.dev) workspace providing the **`web-search`** extension — multi-provider web search and content extraction (Exa, Brave, Tavily) with three LLM-callable tools: `web_search`, `web_fetch`, and `get_fetch_content`.

## Extension

→ **[.pi/extensions/web-search/README.md](.pi/extensions/web-search/README.md)** — full documentation: tools, providers, setup, security, configuration.

## Quick start

```bash
cd .pi/extensions
npm install
```

Set `BRAVE_API_KEY` and/or `TAVILY_API_KEY` in your environment, then start Pi — the extension loads automatically.

## Install from npm

```bash
pi install npm:@svenhornaff/web-search
```

## Agent instructions

→ **[AGENTS.md](AGENTS.md)** — workspace layout, commands, code style, testing rules, commit conventions, and the PR checklist for contributors and AI agents working in this repo.

## License

Non-Commercial Source-Available License (NCSAL) — see [LICENSE](LICENSE).
