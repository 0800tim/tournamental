import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/tournament.ts",
    "src/cascade.ts",
    "src/score.ts",
    "src/standings.ts",
    "src/vstamp.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  clean: true,
  target: "es2022",
  treeshake: true,
  // Force standard extensions regardless of root `type: module`: ESM as
  // `.mjs`, CJS as `.js`. Matches the `publishConfig.exports` map and
  // keeps the published tarball runnable in both module systems.
  outExtension({ format }) {
    return format === "esm" ? { js: ".mjs" } : { js: ".js" };
  },
  // `node:crypto` is consumed by vstamp; mark it external so the
  // output preserves the node: scheme.
  external: ["node:crypto"],
  // Vendor the 2026 fixtures JSON inline via `fixtures-loader.ts` so
  // the package root export is self-contained for consumers.
  loader: {
    ".json": "json",
  },
});
