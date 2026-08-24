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
const extDir = process.argv[2];

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

settings.packages ??= [];
const already = settings.packages.some(
  (p) => p && typeof p === 'object' && p.source === extDir,
);
if (!already) {
  settings.packages.push({ source: extDir, extensions: ['./src/index.ts'] });
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(already ? 'Already registered — left settings.json unchanged.' : 'Registered.');
" "$SETTINGS_FILE" "$EXT_DIR"

echo ""
echo "Done. Set at least one provider key (Keychain recommended — see README §Setup),"
echo "then start (or /reload) Pi in that workspace."