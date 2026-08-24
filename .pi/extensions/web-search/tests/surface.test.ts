/**
 * Surface test — asserts the exact set of tools, commands, widgets, and
 * shortcuts registered by the extension entry point.
 *
 * This is the highest-leverage test in the repo: it turns the "public surface
 * vs docs drift" class of regression into a CI failure instead of a later
 * audit finding. A removal, rename, or addition that isn't reflected in the
 * README and CHANGELOG will fail here before it can ship.
 *
 * Rules:
 *   - If you add/remove/rename a tool, command, or widget: update this test,
 *     the README, and add a CHANGELOG entry.
 *   - The test imports the factory directly and passes a mock pi object — no
 *     real pi runtime needed.
 */
import { describe, test } from "node:test";
import { strict as assert } from "node:assert";

// ── Minimal mock pi API ──────────────────────────────────────────────────

interface MockRegistration {
  tools: string[];
  commands: string[];
  widgets: string[];
  shortcuts: string[];
}

function makeMockPi(): { pi: Record<string, unknown>; reg: MockRegistration } {
  const reg: MockRegistration = { tools: [], commands: [], widgets: [], shortcuts: [] };

  const pi = {
    on: () => {},
    registerTool: (def: { name: string }) => { reg.tools.push(def.name); },
    registerCommand: (name: string) => { reg.commands.push(name); },
    registerShortcut: (key: string) => { reg.shortcuts.push(key); },
  };

  return { pi, reg };
}

// ── Expected surface ────────────────────────────────────────────────────
// Update these when the public surface changes. Every change must also
// appear in the README and CHANGELOG.

const EXPECTED_TOOLS = ["web_search", "web_fetch", "get_fetch_content"];
const EXPECTED_COMMANDS = ["websearch", "websearch-cache"];
const EXPECTED_SHORTCUTS: string[] = []; // Ctrl+Shift+W removed in v0.5.1

describe("public surface — registered tools, commands, shortcuts", () => {
  test("tools match expected set", async () => {
    const { pi, reg } = makeMockPi();
    const { default: factory } = await import("../src/index.ts");
    factory(pi as unknown as Parameters<typeof factory>[0]);

    assert.deepEqual(
      [...reg.tools].sort(),
      [...EXPECTED_TOOLS].sort(),
      `Tool surface changed. Expected: ${EXPECTED_TOOLS.join(", ")}. Got: ${reg.tools.join(", ")}.`,
    );
  });

  test("commands match expected set", async () => {
    const { pi, reg } = makeMockPi();
    const { default: factory } = await import("../src/index.ts");
    factory(pi as unknown as Parameters<typeof factory>[0]);

    assert.deepEqual(
      [...reg.commands].sort(),
      [...EXPECTED_COMMANDS].sort(),
      `Command surface changed. Expected: ${EXPECTED_COMMANDS.join(", ")}. Got: ${reg.commands.join(", ")}.`,
    );
  });

  test("no unexpected shortcuts registered", async () => {
    const { pi, reg } = makeMockPi();
    const { default: factory } = await import("../src/index.ts");
    factory(pi as unknown as Parameters<typeof factory>[0]);

    assert.deepEqual(
      [...reg.shortcuts].sort(),
      [...EXPECTED_SHORTCUTS].sort(),
      `Shortcut surface changed. Expected: [${EXPECTED_SHORTCUTS.join(", ")}]. Got: ${reg.shortcuts.join(", ")}.`,
    );
  });
});
