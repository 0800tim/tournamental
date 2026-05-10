/** Vitest config for `pnpm dump-openapi`. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/dump-openapi.run.ts'],
    reporters: ['default'],
  },
});
