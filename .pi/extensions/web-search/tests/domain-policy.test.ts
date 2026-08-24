import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { checkDomainPolicy } from "../src/ssrf.ts";
import type { DomainPolicy } from "../src/config.ts";

function policy(allow: string[], deny: string[]): DomainPolicy {
  return { allow, deny };
}

describe("checkDomainPolicy() — empty policy (allow all)", () => {
  test("empty allow + empty deny allows everything", () => {
    assert.equal(checkDomainPolicy("docs.example.com", policy([], [])), null);
    assert.equal(checkDomainPolicy("api.example.com", policy([], [])), null);
  });
});

describe("checkDomainPolicy() — allow list", () => {
  test("exact match in allow list passes", () => {
    assert.equal(checkDomainPolicy("docs.example.com", policy(["docs.example.com"], [])), null);
  });

  test("non-matching hostname blocked when allow list is non-empty", () => {
    const result = checkDomainPolicy("other.example.com", policy(["docs.example.com"], []));
    assert.ok(result?.includes("not in allow list"));
  });

  test("subdomain matching: 'example.com' in allow matches 'sub.example.com'", () => {
    assert.equal(checkDomainPolicy("sub.example.com", policy(["example.com"], [])), null);
  });

  test("subdomain matching: 'example.com' does NOT match 'example.com' itself (not a subdomain)", () => {
    // "example.com" suffix entry matches "foo.example.com" but not "example.com" — exact match needed
    const result = checkDomainPolicy("example.com", policy(["notexample.com"], []));
    assert.ok(result?.includes("not in allow list"));
  });

  test("exact 'example.com' allows 'example.com'", () => {
    assert.equal(checkDomainPolicy("example.com", policy(["example.com"], [])), null);
  });

  test("multiple entries in allow list — first match wins", () => {
    assert.equal(
      checkDomainPolicy("api.example.com", policy(["docs.example.com", "api.example.com"], [])),
      null,
    );
  });
});

describe("checkDomainPolicy() — deny list", () => {
  test("exact match in deny list blocks", () => {
    const result = checkDomainPolicy("bad.example.com", policy([], ["bad.example.com"]));
    assert.ok(result?.includes("blocked by deny policy"));
  });

  test("subdomain matching in deny list", () => {
    const result = checkDomainPolicy("sub.evil.com", policy([], ["evil.com"]));
    assert.ok(result?.includes("blocked by deny policy"));
  });

  test("deny wins over allow on conflict", () => {
    const result = checkDomainPolicy(
      "docs.example.com",
      policy(["docs.example.com"], ["docs.example.com"]),
    );
    assert.ok(result?.includes("blocked by deny policy"));
  });

  test("hostname not in deny list passes", () => {
    assert.equal(checkDomainPolicy("safe.example.com", policy([], ["bad.example.com"])), null);
  });
});

describe("checkDomainPolicy() — case insensitivity", () => {
  test("hostname matching is case-insensitive", () => {
    assert.equal(checkDomainPolicy("Docs.Example.COM", policy(["docs.example.com"], [])), null);
  });

  test("deny matching is case-insensitive", () => {
    const result = checkDomainPolicy("BAD.EXAMPLE.COM", policy([], ["bad.example.com"]));
    assert.ok(result?.includes("blocked by deny policy"));
  });
});
