/**
 * URL safety checks for outbound fetches.
 *
 * We intentionally allow only public HTTPS URLs. This blocks common SSRF
 * primitives such as localhost, private RFC1918 networks, loopback, link-local,
 * and non-HTTP(S) schemes before any network call is made.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { DomainPolicy } from "./config.js";

/**
 * Check a hostname against a domain policy.
 * Deny wins on conflict (an entry in both allow and deny is denied).
 * Returns an error message if blocked, or null if allowed.
 *
 * Matching rules:
 *   - Exact match:  "docs.example.com" matches only "docs.example.com"
 *   - Suffix match: ".example.com" matches "foo.example.com" but not "example.com"
 */
export function checkDomainPolicy(hostname: string, policy: DomainPolicy): string | null {
  const host = hostname.toLowerCase();

  // Deny list checked first — deny wins.
  for (const entry of policy.deny) {
    if (matchesDomainEntry(host, entry.toLowerCase())) {
      return `Domain blocked by deny policy: ${hostname}`;
    }
  }

  // If allow list is non-empty, hostname must match at least one entry.
  if (policy.allow.length > 0) {
    const allowed = policy.allow.some((entry) => matchesDomainEntry(host, entry.toLowerCase()));
    if (!allowed) {
      return `Domain not in allow list: ${hostname}`;
    }
  }

  return null; // allowed
}

function matchesDomainEntry(hostname: string, entry: string): boolean {
  // Exact match
  if (hostname === entry) return true;
  // Suffix match: entry starting with "." matches subdomains
  if (entry.startsWith(".") && hostname.endsWith(entry)) return true;
  // Also match "example.com" as a suffix pattern for "*.example.com"
  if (!entry.startsWith(".") && hostname.endsWith("." + entry)) return true;
  return false;
}

const ALLOWED_PROTOCOLS = new Set(["https:"]);

export async function validateFetchUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol.toLowerCase())) {
    throw new Error(`Only https:// URLs are allowed: ${rawUrl}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`Localhost URLs are blocked: ${rawUrl}`);
  }

  const ipCandidates = isIP(hostname) !== 0 ? [hostname] : await lookup(hostname, { all: true }).then((records) => records.map((r) => r.address));

  for (const candidate of ipCandidates) {
    if (isBlockedIp(candidate)) {
      throw new Error(`Blocked network target: ${hostname}`);
    }
  }

  return url;
}

function isBlockedIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed || trimmed === "0.0.0.0") return true;

  if (isIPv4(trimmed)) {
    return isBlockedIpv4(trimmed);
  }

  if (isIPv6(trimmed)) {
    return isBlockedIpv6(trimmed);
  }

  return false;
}

function isIPv4(value: string): boolean {
  return isIP(value) === 4;
}

function isIPv6(value: string): boolean {
  return isIP(value) === 6;
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return false;
  }

  const [a, b, c, d] = octets;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return false;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80")) return true;
  if (normalized.startsWith("::ffff:")) {
    const ipv4 = normalized.slice("::ffff:".length);
    return isBlockedIpv4(ipv4);
  }
  return false;
}
