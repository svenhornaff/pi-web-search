/**
 * GitHub URL handler for web_fetch.
 *
 * Detects GitHub URL patterns and routes to the optimal fetch strategy
 * instead of treating them as generic HTML (which loses structure).
 *
 * Patterns handled:
 *   /owner/repo/blob/ref/path  → raw.githubusercontent.com direct fetch
 *   /owner/repo/tree/ref/path  → GitHub API directory listing
 *   /owner/repo                → GitHub API: README + top-level file tree
 *
 * All fetches go through safeFetch (SSRF guard, redirect validation, 5 MB cap).
 * GitHub API is called without auth — public repos only, rate limit 60 req/hr.
 * If the GitHub API call fails, returns null so the caller falls back to HTML.
 */

import { safeFetch, readBoundedText } from "./safe-fetch.js";

export interface GitHubResult {
  /** Markdown content ready for the content pipeline */
  markdown: string;
  /** Page title (repo name or file path) */
  title: string;
  /** Canonical URL used */
  url: string;
  /** Strategy used (for details/debugging) */
  strategy: "raw" | "api-tree" | "api-readme";
}

/** GitHub URL pattern detector */
export interface GitHubUrlMatch {
  owner: string;
  repo: string;
  /** undefined = repo root */
  type?: "blob" | "tree";
  /** ref + path after blob/tree, e.g. "main/src/index.ts" */
  refPath?: string;
}

const GITHUB_HOST_RE = /^https:\/\/github\.com\//;
// Matches: /owner/repo  OR  /owner/repo/blob/ref/...  OR  /owner/repo/tree/ref/...
const GITHUB_PATH_RE =
  /^\/([^/]+)\/([^/]+?)(?:\/(blob|tree)\/(.+))?(?:\.git)?$/;

/**
 * Returns a match if the URL is a GitHub URL we can handle specially,
 * or null if it should fall through to generic HTML extraction.
 */
export function matchGitHubUrl(url: string): GitHubUrlMatch | null {
  if (!GITHUB_HOST_RE.test(url)) return null;

  try {
    const parsed = new URL(url);
    const m = GITHUB_PATH_RE.exec(parsed.pathname);
    if (!m) return null;

    const [, owner, repo, type, refPath] = m;
    if (!owner || !repo) return null;
    // Skip non-content paths: issues, pulls, actions, releases, etc.
    if (["issues", "pulls", "actions", "releases", "wiki", "settings", "commit", "compare"].includes(repo)) return null;

    return {
      owner,
      repo,
      type: type as "blob" | "tree" | undefined,
      refPath,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a GitHub URL using the optimal strategy.
 * Returns null if the strategy fails — caller should fall back to HTML.
 */
export async function fetchGitHub(
  url: string,
  match: GitHubUrlMatch,
  signal?: AbortSignal,
): Promise<GitHubResult | null> {
  try {
    if (match.type === "blob" && match.refPath) {
      return await fetchRawFile(url, match, signal);
    }
    if (match.type === "tree" && match.refPath) {
      return await fetchTreeListing(url, match, signal);
    }
    // Repo root
    return await fetchRepoRoot(url, match, signal);
  } catch {
    // Any failure → return null, let caller use generic HTML extraction
    return null;
  }
}

/** /owner/repo/blob/ref/path → raw.githubusercontent.com */
async function fetchRawFile(
  originalUrl: string,
  match: GitHubUrlMatch,
  signal?: AbortSignal,
): Promise<GitHubResult | null> {
  const rawUrl = `https://raw.githubusercontent.com/${match.owner}/${match.repo}/${match.refPath}`;
  const response = await safeFetch(rawUrl, {
    headers: { Accept: "text/plain,*/*" },
    signal,
  });
  if (!response.ok) return null;

  const content = await readBoundedText(response);
  const fileName = match.refPath?.split("/").pop() ?? "file";
  const isMarkdown = /\.(md|mdx|markdown)$/i.test(fileName);

  const markdown = isMarkdown
    ? content
    : `\`\`\`${extensionToLang(fileName)}\n${content}\n\`\`\``;

  return {
    markdown,
    title: `${match.owner}/${match.repo}: ${match.refPath}`,
    url: originalUrl,
    strategy: "raw",
  };
}

/** /owner/repo/tree/ref/path → GitHub API tree listing */
async function fetchTreeListing(
  originalUrl: string,
  match: GitHubUrlMatch,
  signal?: AbortSignal,
): Promise<GitHubResult | null> {
  // refPath = "main/src/lib" → ref="main", path="src/lib"
  const parts = (match.refPath ?? "").split("/");
  const ref = parts[0];
  const dirPath = parts.slice(1).join("/");

  const apiUrl = `https://api.github.com/repos/${match.owner}/${match.repo}/contents/${dirPath}?ref=${ref}`;
  const response = await safeFetch(apiUrl, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal,
  });
  if (!response.ok) return null;

  const items = (await response.json()) as Array<{
    name: string;
    type: "file" | "dir";
    size?: number;
    download_url?: string;
  }>;

  if (!Array.isArray(items)) return null;

  const lines = [
    `# ${match.owner}/${match.repo}/${dirPath || ""}`,
    "",
    "| Name | Type | Size |",
    "|------|------|------|",
    ...items.map((item) =>
      `| \`${item.name}\` | ${item.type} | ${item.size != null ? `${item.size} bytes` : "—"} |`
    ),
  ];

  return {
    markdown: lines.join("\n"),
    title: `${match.owner}/${match.repo}/${dirPath}`,
    url: originalUrl,
    strategy: "api-tree",
  };
}

/** /owner/repo → repo README + top-level file listing */
async function fetchRepoRoot(
  originalUrl: string,
  match: GitHubUrlMatch,
  signal?: AbortSignal,
): Promise<GitHubResult | null> {
  // Fetch README and top-level contents in parallel
  const [readmeResponse, contentsResponse] = await Promise.allSettled([
    safeFetch(`https://api.github.com/repos/${match.owner}/${match.repo}/readme`, {
      headers: { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal,
    }),
    safeFetch(`https://api.github.com/repos/${match.owner}/${match.repo}/contents`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal,
    }),
  ]);

  const sections: string[] = [`# ${match.owner}/${match.repo}`, ""];

  // README
  if (readmeResponse.status === "fulfilled" && readmeResponse.value.ok) {
    const readme = await readBoundedText(readmeResponse.value);
    sections.push(readme, "");
  }

  // File tree
  if (contentsResponse.status === "fulfilled" && contentsResponse.value.ok) {
    const items = (await contentsResponse.value.json()) as Array<{
      name: string;
      type: "file" | "dir";
      size?: number;
    }>;
    if (Array.isArray(items) && items.length > 0) {
      sections.push("## Repository Contents", "");
      sections.push("| Name | Type |", "|------|------|");
      for (const item of items) {
        sections.push(`| \`${item.name}\` | ${item.type} |`);
      }
    }
  }

  if (sections.length <= 2) return null; // nothing fetched

  return {
    markdown: sections.join("\n"),
    title: `${match.owner}/${match.repo}`,
    url: originalUrl,
    strategy: "api-readme",
  };
}

/** Map common file extensions to language identifiers for code fences */
function extensionToLang(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", rb: "ruby",
    sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml",
    json: "json", toml: "toml", md: "markdown", mdx: "markdown",
    html: "html", css: "css", sql: "sql", c: "c", cpp: "cpp", h: "c",
  };
  return map[ext] ?? ext;
}
