import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cards/index.ts",
    "src/theme.ts",
    "src/fonts.ts",
    "src/canvas/index.ts",
    "src/video/index.ts",
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
  // Native + heavy runtime deps stay external so we ship a small
  // dist/. Consumers install them alongside us.
  external: [
    "@napi-rs/canvas",
    "@resvg/resvg-js",
    "qrcode",
    "satori",
  ],
});
