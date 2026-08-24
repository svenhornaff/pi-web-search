/**
 * ESM loader hook: resolves .js imports to .ts when a matching .ts file exists.
 * Enables Node --experimental-strip-types test runner to work across TS source files.
 *
 * Usage (package.json test script):
 *   node --import ./hooks/ts-resolve.mjs --experimental-strip-types --test ...
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.endsWith(".js") &&
      context.parentURL &&
      context.parentURL.includes("/web-search/")
    ) {
      const resolved = new URL(specifier, context.parentURL);
      const jsPath = fileURLToPath(resolved);
      const tsPath = jsPath.replace(/\.js$/, ".ts");
      if (existsSync(tsPath)) {
        return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
      }
    }
    return nextResolve(specifier, context);
  },
});
