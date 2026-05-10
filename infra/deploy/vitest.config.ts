import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'lib/__tests__/**/*.test.ts',
      '__tests__/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
    testTimeout: 15_000,
    env: {
      NODE_ENV: 'test',
    },
  },
});
