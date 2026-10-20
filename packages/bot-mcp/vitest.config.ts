import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests run before the workspace build, so the SDK's dist entry does
    // not exist yet in CI; resolve the package to its source (the
    // tsconfig paths already do the same for typecheck).
    alias: { "@tournamental/bot-sdk": new URL("../bot-sdk/src/index.ts", import.meta.url).pathname },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 10_000,
    env: {
      NODE_ENV: "test",
    },
  },
});
