import { defineConfig } from "tsup";

/**
 * Two entries:
 *  - `index`: the library surface (exported tools + server factory) so other
 *    Node code can embed the MCP server in a custom transport.
 *  - `cli`:   the stdio binary linked via `bin: tournamental-bot-mcp`.
 *
 * tsup emits a single shebang banner across all entries; the binary needs
 * one, the library will have a redundant but harmless `#!/usr/bin/env node`
 * stripped by every reasonable consumer. To keep `index.mjs` clean for
 * library use we run two builds via a single config.
 */
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    outExtension: ({ format }) => ({
      js: format === "esm" ? ".mjs" : ".cjs",
    }),
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    treeshake: true,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    dts: false,
    sourcemap: true,
    clean: false,
    target: "es2022",
    treeshake: true,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
