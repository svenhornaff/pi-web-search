import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { extractStructuredData } from "../src/structured-extractor.ts";

// ── JSON-LD ───────────────────────────────────────────────────────────────

describe("JSON-LD extraction", () => {
  test("extracts name as title", () => {
    const html = `<script type="application/ld+json">{"@type":"SoftwareSourceCode","name":"FastAPI","description":"Modern web framework"}</script>`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "FastAPI");
    assert.equal(r?.description, "Modern web framework");
    assert.equal(r?.type, "SoftwareSourceCode");
  });

  test("extracts headline as title when name absent", () => {
    const html = `<script type="application/ld+json">{"@type":"Article","headline":"How async works"}</script>`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "How async works");
    assert.equal(r?.type, "Article");
    // No description in the JSON-LD — description should be undefined
    assert.equal(r?.description, undefined);
  });

  test("extracts datePublished as publishedTime", () => {
    const html = `<script type="application/ld+json">{"name":"T","description":"D","datePublished":"2026-01-15"}</script>`;
    const r = extractStructuredData(html);
    assert.equal(r?.publishedTime, "2026-01-15");
  });

  test("extracts dateCreated when datePublished absent", () => {
    const html = `<script type="application/ld+json">{"name":"T","description":"D","dateCreated":"2025-12-01"}</script>`;
    const r = extractStructuredData(html);
    assert.equal(r?.publishedTime, "2025-12-01");
  });

  test("handles array form — uses first element", () => {
    const html = `<script type="application/ld+json">[{"@type":"Article","headline":"Array Title","description":"desc"}]</script>`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "Array Title");
  });

  test("falls through malformed JSON to next block", () => {
    const html = `<script type="application/ld+json">{bad json}</script>
<meta property="og:title" content="OG Fallback">`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "OG Fallback");
  });

  test("returns null when JSON-LD has no name/description/headline", () => {
    const html = `<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>`;
    // Should fall through to OG/meta — if none, null
    const r = extractStructuredData(html);
    assert.equal(r, null);
  });

  test("multiple JSON-LD blocks — first with usable data wins", () => {
    const html = `
<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
<script type="application/ld+json">{"name":"Second Block","description":"Found it"}</script>`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "Second Block");
  });

  test("consecutive calls with same HTML return consistent results (regex lastIndex reset)", () => {
    // JSON_LD_RE has the /g flag — if lastIndex is not reset on early return,
    // alternating calls on the same string would return null every other call.
    const html = `<script type="application/ld+json">{"name":"T","description":"D","dateCreated":"2025-12-01"}</script>`;
    const r1 = extractStructuredData(html);
    const r2 = extractStructuredData(html);
    const r3 = extractStructuredData(html);
    assert.equal(r1?.title, "T", "call 1 should find data");
    assert.equal(r2?.title, "T", "call 2 should find data (lastIndex must be reset)");
    assert.equal(r3?.title, "T", "call 3 should find data");
    assert.equal(r1?.publishedTime, "2025-12-01", "dateCreated should map to publishedTime");
  });

  test("single quote variant of type attribute", () => {
    const html = `<script type='application/ld+json'>{"name":"Single Quotes","description":"works"}</script>`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "Single Quotes");
    assert.equal(r?.description, "works");
  });
});

// ── OpenGraph ─────────────────────────────────────────────────────────────

describe("OpenGraph extraction (fallback from JSON-LD)", () => {
  test("extracts og:title and og:description", () => {
    const html = `<meta property="og:title" content="OG Title">
<meta property="og:description" content="OG Description">`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "OG Title");
    assert.equal(r?.description, "OG Description");
  });

  test("falls back to twitter:title when og:title absent", () => {
    const html = `<meta name="twitter:title" content="Twitter Title">`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "Twitter Title");
  });

  test("extracts article:published_time", () => {
    const html = `<meta property="og:title" content="T">
<meta property="article:published_time" content="2026-03-01T10:00:00Z">`;
    const r = extractStructuredData(html);
    assert.equal(r?.publishedTime, "2026-03-01T10:00:00Z");
  });

  test("extracts og:type", () => {
    const html = `<meta property="og:title" content="T">
<meta property="og:type" content="article">`;
    const r = extractStructuredData(html);
    assert.equal(r?.type, "article");
  });

  test("JSON-LD takes precedence over OpenGraph", () => {
    const html = `<script type="application/ld+json">{"name":"JSON-LD Title","description":"desc"}</script>
<meta property="og:title" content="OG Title">`;
    const r = extractStructuredData(html);
    assert.equal(r?.title, "JSON-LD Title");
  });
});

// ── Meta description fallback ─────────────────────────────────────────────

describe("meta description fallback", () => {
  test("extracts meta name=description", () => {
    const html = `<meta name="description" content="A plain description">`;
    const r = extractStructuredData(html);
    assert.equal(r?.description, "A plain description");
    assert.equal(r?.title, undefined);
  });

  test("OpenGraph takes precedence over meta description", () => {
    const html = `<meta property="og:description" content="OG Desc">
<meta name="description" content="Meta Desc">`;
    const r = extractStructuredData(html);
    assert.equal(r?.description, "OG Desc");
  });
});

// ── Returns null ──────────────────────────────────────────────────────────

describe("returns null when nothing found", () => {
  test("empty string", () => {
    assert.equal(extractStructuredData(""), null);
  });

  test("HTML with no metadata", () => {
    assert.equal(extractStructuredData("<html><body>No metadata here</body></html>"), null);
  });

  test("only scripts, no metadata", () => {
    assert.equal(extractStructuredData("<script>var x = 1;</script>"), null);
  });
});
