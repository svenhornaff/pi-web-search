#!/usr/bin/env node
/**
 * Fails if package.json's version and CHANGELOG.md's top entry drift apart.
 * This exact bug class has recurred twice (0.3.4/0.3.3, then 0.4.1/0.4.0) —
 * a CI check catches it; nobody reliably remembers to check by hand.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8"));
const changelog = readFileSync(resolve(here, "../CHANGELOG.md"), "utf8");

const match = changelog.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
if (!match) {
  console.error("check-version: no version heading found in CHANGELOG.md");
  process.exit(1);
}

const [, changelogVersion] = match;
if (pkg.version !== changelogVersion) {
  console.error(
    `check-version: version drift — package.json is ${pkg.version}, CHANGELOG.md top entry is ${changelogVersion}`,
  );
  process.exit(1);
}

console.log(`check-version: OK (${pkg.version})`);
