#!/usr/bin/env bash
# Registers this extension into a target Pi workspace (or globally) without
# copying any files — Pi loads TypeScript extensions directly via jiti, so
# the workspace's settings.json just needs to point at this source.
#
# Usage:
#   scripts/install-local.sh [TARGET_WORKSPACE]      # project-local (default: cwd)
#   scripts/install-local.sh --global                # ~/.pi/agent/settings.json
#
# What it does:
#   1. Resolves this extension's own directory (works from any clone location)
#   2. Runs `npm install` here once, so node_modules exists
#   3. Safely merges a `packages` entry into the target settings.json — never
#      overwrites the file; creates it if missing, preserves everything else
#      if present
#
# Equivalent one-shot alternative that needs no registration at all:
#   pi -e /path/to/this/extension

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"   # .pi/extensions/web-search

# Guard against the script having been copied/moved out of scripts/ — a
# relocated copy silently computes the wrong EXT_DIR (see install pain: a
# script copied to a target workspace and run from there resolves EXT_DIR to
# that workspace's parent, not the extension). Fail loud and specific instead
# of letting `npm install` fail two steps later with a confusing ENOENT.
if [ ! -f "$EXT_DIR/package.json" ] || ! grep -q '"pi"' "$EXT_DIR/package.json" 2>/dev/null; then
  echo "Error: this script must be run from its original location inside the" >&2
  echo "extension (.pi/extensions/web-search/scripts/install-local.sh) — it" >&2
  echo "locates the extension relative to itself, and does not work if copied" >&2
  echo "elsewhere (e.g. into the target workspace)." >&2
  echo "" >&2
  echo "Computed extension dir: $EXT_DIR" >&2
  echo "  -> no valid package.json with a \"pi\" field found there." >&2
  echo "" >&2
  echo "Run it from the real location instead, pointing AT the target workspace:" >&2
  echo "  bash /path/to/pi-web-search/.pi/extensions/web-search/scripts/install-local.sh /path/to/target-workspace" >&2
  exit 1
fi

if [ "${1:-}" = "--global" ]; then
  SETTINGS_FILE="$HOME/.pi/agent/settings.json"
else
  TARGET="${1:-$(pwd)}"
  SETTINGS_FILE="$TARGET/.pi/settings.json"
fi

mkdir -p "$(dirname "$SETTINGS_FILE")"

echo "Extension source: $EXT_DIR"
echo "Target settings:  $SETTINGS_FILE"

echo "Installing extension dependencies..."
(cd "$EXT_DIR" && npm install --omit=dev --no-audit --no-fund)

node --input-type=module -e "
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const settingsPath = process.argv[1];
const entryFile = process.argv[2];

let settings = {};
if (existsSync(settingsPath)) {
  const raw = readFileSync(settingsPath, 'utf8').trim();
  if (raw) {
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      console.error(\`Existing \${settingsPath} is not valid JSON (\${err.message}).\`);
      console.error('Refusing to overwrite it automatically — back it up, fix or delete it, then re-run.');
      process.exit(1);
    }
  }
}

// Local filesystem sources go in the top-level 'extensions' array, NOT
// nested inside 'packages' (that array's 'source' field is for npm:/git:
// remote sources only — a plain local path there is silently never loaded).
// Point at the entry .ts file directly, not the directory: pointing at a
// directory has a known open bug (earendil-works/pi#1274) where the
// directory's package.json 'pi.extensions' manifest isn't reliably resolved.
settings.extensions ??= [];
const already = settings.extensions.includes(entryFile);
if (!already) {
  settings.extensions.push(entryFile);
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(already ? 'Already registered — left settings.json unchanged.' : 'Registered.');
" "$SETTINGS_FILE" "$EXT_DIR/src/index.ts"

echo ""
echo "Set at least one provider key (Keychain recommended — see README §Setup)."
echo ""
echo "IMPORTANT — project trust: a workspace pi hasn't seen before has no saved"
echo "trust decision, so on interactive startup pi will PROMPT before loading"
echo "any project-local .pi/settings.json content at all, including this"
echo "registration. Answer yes at that prompt (or run /trust once inside the"
echo "session) — until you do, the extension is registered on disk but not"
echo "actually loaded. Non-interactive modes (-p, --mode json, --mode rpc)"
echo "never show that prompt and need --approve/-a passed explicitly instead."