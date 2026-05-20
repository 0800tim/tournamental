import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "__tests__/**/*.test.ts"],
    // Editorial preset renders run satori + resvg end-to-end, which is
    // I/O heavy. Bump the default 5s timeout so the slowest sample
    // (the story-format syndicate-invite, ~3-4s on the dev box) does
    // not flake the suite.
    testTimeout: 30_000,
  },
});
