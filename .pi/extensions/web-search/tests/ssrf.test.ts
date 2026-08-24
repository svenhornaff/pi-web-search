import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { validateFetchUrl, checkDomainPolicy } from "../src/ssrf.ts";
import type { DomainPolicy } from "../src/config.ts";

function policy(allow: string[], deny: string[]): DomainPolicy {
  return { allow, deny };
}

// ── Original tests (regression guard) ────────────────────────────────────────

describe("validateFetchUrl()", () => {
  test("accepts public HTTPS URLs", async () => {
    const { url, resolvedIp } = await validateFetchUrl("https://example.com/path");
    assert.equal(url.hostname, "example.com");
    // resolvedIp should be a non-empty string (actual IP depends on DNS)
    assert.ok(typeof resolvedIp === "string" && resolvedIp.length > 0);
  });

  test("rejects non-HTTPS schemes", async () => {
    await assert.rejects(() => validateFetchUrl("file:///tmp/test.txt"), /Only https:\/\//);
    await assert.rejects(() => validateFetchUrl("javascript:alert(1)"), /Only https:\/\//);
  });

  test("rejects localhost and local network targets", async () => {
    await assert.rejects(() => validateFetchUrl("https://localhost:3000"), /Localhost|Blocked network target/);
    await assert.rejects(() => validateFetchUrl("https://127.0.0.1"), /Blocked network target/);
  });
});

// ── 3.1: IPv4 special-use ranges (previously missing) ────────────────────────

describe("isBlockedIpv4 — RFC ranges added in 3.1", () => {
  // Test via validateFetchUrl() with literal IP hosts — exercises real integration path.
  async function rejectsIP(ip: string): Promise<void> {
    await assert.rejects(
      () => validateFetchUrl(`https://${ip}/`),
      /Blocked network target/,
      `Expected ${ip} to be blocked`,
    );
  }

  // Newly added ranges
  test("TEST-NET-1 (192.0.2.0/24) is blocked", () => rejectsIP("192.0.2.1"));
  test("TEST-NET-2 (198.51.100.0/24) is blocked", () => rejectsIP("198.51.100.1"));
  test("Multicast low (224.0.0.1) is blocked", () => rejectsIP("224.0.0.1"));
  test("Multicast high (239.255.255.255) is blocked", () => rejectsIP("239.255.255.255"));
  test("Reserved (240.0.0.1) is blocked", () => rejectsIP("240.0.0.1"));
  test("Broadcast (255.255.255.255) is blocked", () => rejectsIP("255.255.255.255"));

  // Pre-existing ranges — regression guard
  test("RFC 1918 10.x.x.x still blocked", () => rejectsIP("10.0.0.1"));
  test("Link-local 169.254.x.x still blocked", () => rejectsIP("169.254.1.1"));
  test("CGNAT 100.64.x.x still blocked", () => rejectsIP("100.64.0.1"));
});

// ── 3.1: IPv6 special-use ranges (previously missing) ────────────────────────

describe("isBlockedIpv6 — special-use ranges added in 3.1", () => {
  async function rejectsIPv6(ip: string): Promise<void> {
    await assert.rejects(
      () => validateFetchUrl(`https://[${ip}]/`),
      /Blocked network target/,
      `Expected [${ip}] to be blocked`,
    );
  }

  // Newly added
  test("IPv6 unspecified (::) is blocked", () => rejectsIPv6("::"));
  test("IPv6 multicast ff02::1 is blocked", () => rejectsIPv6("ff02::1"));
  test("IPv6 multicast ff00:: is blocked", () => rejectsIPv6("ff00::"));

  // Pre-existing — regression guard
  test("IPv6 loopback ::1 still blocked", () => rejectsIPv6("::1"));
  test("IPv6 link-local fe80::1 still blocked", () => rejectsIPv6("fe80::1"));
  test("IPv6 ULA fc00::1 still blocked", () => rejectsIPv6("fc00::1"));
});

// ── 3.3: Domain policy trailing-dot normalization ─────────────────────────────

describe("checkDomainPolicy() — trailing-dot normalization (3.3)", () => {
  test("hostname with trailing dot matches allow entry without dot", () => {
    assert.equal(
      checkDomainPolicy("docs.example.com.", policy(["docs.example.com"], [])),
      null,
      "trailing-dot host should match non-dot allow entry",
    );
  });

  test("hostname without trailing dot matches allow entry with trailing dot", () => {
    assert.equal(
      checkDomainPolicy("docs.example.com", policy(["docs.example.com."], [])),
      null,
      "non-dot host should match trailing-dot allow entry",
    );
  });

  test("hostname with trailing dot blocked by deny entry without dot", () => {
    const result = checkDomainPolicy("bad.example.com.", policy([], ["bad.example.com"]));
    assert.ok(result?.includes("blocked by deny"), "trailing-dot host should be denied by non-dot entry");
  });

  test("both hostname and entry have trailing dot — still matches", () => {
    assert.equal(
      checkDomainPolicy("docs.example.com.", policy(["docs.example.com."], [])),
      null,
    );
  });

  test("subdomain with trailing dot matches parent allow entry", () => {
    assert.equal(
      checkDomainPolicy("sub.example.com.", policy(["example.com"], [])),
      null,
      "trailing-dot subdomain should match parent allow entry",
    );
  });
});

// ── 3.2: GitHub handler bounded reader coverage note ─────────────────────────
// The two response.json() → readBoundedText+JSON.parse() fixes in
// github-handler.ts are exercised by the existing github-handler.test.ts
// tests which mock fetch. The fix is also a correctness property — the
// bounded reader would throw on a >5 MB body before JSON.parse sees it.
// No separate test added here; the existing tree/root strategy tests cover
// the deserialization path.
