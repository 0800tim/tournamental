import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  esbuild: {
    // React 17+ automatic JSX runtime so .tsx files don't need an
    // explicit `import React from "react"`.
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    env: {
      // The syndicate persistence singleton defaults to
      // ./apps/game/data/game.db relative to the working directory, so a
      // test that reaches it with no path (s-guid-resolver via the
      // syndicate store) used to create an empty SQLite file under
      // apps/web/apps/game/data/. Production sets GAME_DB_PATH itself;
      // tests get an in-memory database.
      GAME_DB_PATH: ":memory:",
    },
    // The bracket builder renders 104 match rows; a cold render takes a
    // few seconds under jsdom and more when the box is busy, so the
    // default 5 s timeout produced spurious STACK_TRACE_ERROR failures.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: [
      "__tests__/**/*.test.{ts,tsx}",
      "lib/**/test/**/*.test.{ts,tsx}",
    ],
    // Playwright e2e specs live under __tests__/e2e and use `.e2e.spec.ts`
    // suffix; they are intentionally excluded from vitest because they
    // require a real browser and a dev server.
    exclude: ["__tests__/e2e/**", "**/node_modules/**"],
  },
});
