import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: false,
    clean: true,
    target: "es2022",
    treeshake: true,
    platform: "node",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: false,
    target: "es2022",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
