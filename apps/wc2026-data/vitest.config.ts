import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
