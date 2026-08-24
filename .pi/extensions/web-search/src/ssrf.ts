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
  // Normalize trailing dot (valid FQDN form: "example.com." == "example.com")
  const host = hostname.toLowerCase().replace(/\.$/, "");

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
  // Both hostname and entry are already lowercased by the caller.
  // Strip trailing dot from entry too — policy entries written with or without
  // a trailing dot both match the same hosts.
  const normEntry = entry.replace(/\.$/, "");
  // Exact match
  if (hostname === normEntry) return true;
  // Suffix match: entry starting with "." matches subdomains
  if (normEntry.startsWith(".") && hostname.endsWith(normEntry)) return true;
  // Also match "example.com" as a suffix pattern for "*.example.com"
  if (!normEntry.startsWith(".") && hostname.endsWith("." + normEntry)) return true;
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

  // url.hostname wraps IPv6 literals in brackets (e.g. "[::1]") — strip them
  // before isIP() so IPv6 addresses are recognised as IP literals, not hostnames.
  const rawHostname = url.hostname.toLowerCase();
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;

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

  // RFC 1122 — this host (0.0.0.0/8)
  if (a === 0) return true;
  // Loopback (127.0.0.0/8)
  if (a === 127) return true;
  // Private Class A (10.0.0.0/8)
  if (a === 10) return true;
  // Link-local (169.254.0.0/16)
  if (a === 169 && b === 254) return true;
  // Shared Address Space / CGNAT (100.64.0.0/10)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Private Class B (172.16.0.0/12)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Private Class C (192.168.0.0/16)
  if (a === 192 && b === 168) return true;
  // Benchmarking (198.18.0.0/15)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // TEST-NET-1 (192.0.2.0/24)
  if (a === 192 && b === 0 && c === 2) return true;
  // TEST-NET-2 (198.51.100.0/24)
  if (a === 198 && b === 51 && c === 100) return true;
  // TEST-NET-3 / Documentation (203.0.113.0/24)
  if (a === 203 && b === 0 && c === 113) return true;
  // Multicast (224.0.0.0/4)
  if (a >= 224 && a <= 239) return true;
  // Reserved / broadcast (240.0.0.0/4 and 255.255.255.255)
  if (a >= 240) return true;

  void d; // d parsed but not needed for current checks — suppress lint
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  // Loopback (::1)
  if (normalized === "::1") return true;
  // Unspecified address (::)
  if (normalized === "::") return true;
  // Unique Local (fc00::/7 — fc:: and fd::)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // Link-local (fe80::/10)
  if (normalized.startsWith("fe80")) return true;
  // Multicast (ff00::/8)
  if (normalized.startsWith("ff")) return true;
  // IPv4-mapped (::ffff:x.x.x.x) — check the embedded IPv4 part
  if (normalized.startsWith("::ffff:")) {
    const ipv4 = normalized.slice("::ffff:".length);
    return isBlockedIpv4(ipv4);
  }
  return false;
}
