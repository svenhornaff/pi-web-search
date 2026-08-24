import { describe, test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.ts";

// We control which config file is loaded by setting PI_CODING_AGENT_DIR.
const TMP = join(tmpdir(), `pi-web-search-config-test-${process.pid}`);
const CONFIG_PATH = join(TMP, "web-search.json");

before(async () => {
  await mkdir(TMP, { recursive: true });
});

after(async () => {
  await unlink(CONFIG_PATH).catch(() => {});
  await unlink(TMP).catch(() => {});
});

async function writeConfig(obj: object): Promise<void> {
  await writeFile(CONFIG_PATH, JSON.stringify(obj), "utf-8");
  process.env["PI_CODING_AGENT_DIR"] = TMP;
}

async function removeConfig(): Promise<void> {
  await unlink(CONFIG_PATH).catch(() => {});
  delete process.env["PI_CODING_AGENT_DIR"];
}

describe("loadConfig() — defaults", () => {
  test("returns defaults when no config file exists", async () => {
    await removeConfig();
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "auto");
    assert.deepEqual(config.fallbackOrder, ["exa", "brave", "tavily"]);
    assert.equal(config.maxResults, 5);
    assert.equal(config.maxInlineContentChars, 30_000);
  });
});

describe("loadConfig() — valid overrides", () => {
  test("reads defaultProvider", async () => {
    await writeConfig({ defaultProvider: "tavily" });
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "tavily");
  });

  test("reads fallbackOrder", async () => {
    await writeConfig({ fallbackOrder: ["tavily", "brave"] });
    const config = await loadConfig();
    assert.deepEqual(config.fallbackOrder, ["tavily", "brave"]);
  });

  test("reads maxResults", async () => {
    await writeConfig({ maxResults: 10 });
    const config = await loadConfig();
    assert.equal(config.maxResults, 10);
  });

  test("reads maxInlineContentChars", async () => {
    await writeConfig({ maxInlineContentChars: 50_000 });
    const config = await loadConfig();
    assert.equal(config.maxInlineContentChars, 50_000);
  });

  test("accepts defaultProvider 'auto'", async () => {
    await writeConfig({ defaultProvider: "auto" });
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "auto");
  });
});

describe("loadConfig() — invalid values fall back to defaults", () => {
  test("unknown defaultProvider → default", async () => {
    await writeConfig({ defaultProvider: "unknown-provider" });
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "auto");
  });

  test("maxResults out of range → default", async () => {
    await writeConfig({ maxResults: 999 });
    const config = await loadConfig();
    assert.equal(config.maxResults, 5);
  });

  test("maxResults < 1 → default", async () => {
    await writeConfig({ maxResults: 0 });
    const config = await loadConfig();
    assert.equal(config.maxResults, 5);
  });

  test("maxInlineContentChars too small → default", async () => {
    await writeConfig({ maxInlineContentChars: 100 });
    const config = await loadConfig();
    assert.equal(config.maxInlineContentChars, 30_000);
  });

  test("fallbackOrder with unknown provider name filtered out", async () => {
    await writeConfig({ fallbackOrder: ["exa", "brave", "nonexistent", "tavily"] });
    const config = await loadConfig();
    assert.deepEqual(config.fallbackOrder, ["exa", "brave", "tavily"]);
  });

  test("fallbackOrder all-invalid → default", async () => {
    await writeConfig({ fallbackOrder: ["bad1", "bad2"] });
    const config = await loadConfig();
    assert.deepEqual(config.fallbackOrder, ["exa", "brave", "tavily"]);
  });
});

describe("loadConfig() — malformed file", () => {
  test("invalid JSON → returns defaults", async () => {
    await writeFile(CONFIG_PATH, "{ not valid json", "utf-8");
    process.env["PI_CODING_AGENT_DIR"] = TMP;
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "auto");
  });

  test("empty file → returns defaults", async () => {
    await writeFile(CONFIG_PATH, "", "utf-8");
    process.env["PI_CODING_AGENT_DIR"] = TMP;
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "auto");
  });
});

describe("loadConfig() — env var interpolation", () => {
  test("interpolates $ENV_VAR in string values", async () => {
    process.env["TEST_WS_PROVIDER"] = "tavily";
    await writeConfig({ defaultProvider: "$TEST_WS_PROVIDER" });
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "tavily");
    delete process.env["TEST_WS_PROVIDER"];
  });

  test("unset env var interpolates to empty string → falls back to default", async () => {
    delete process.env["UNSET_WS_PROVIDER"];
    await writeConfig({ defaultProvider: "$UNSET_WS_PROVIDER" });
    const config = await loadConfig();
    assert.equal(config.defaultProvider, "auto"); // "" is not a valid provider
  });
});
