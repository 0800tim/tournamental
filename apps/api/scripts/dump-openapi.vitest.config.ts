/**
 * Vitest config used only by `pnpm dump-openapi` to run the
 * scripts/dump-openapi.run.ts file. Keeps the regular test config clean.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/dump-openapi.run.ts'],
    reporters: ['default'],
  },
});
