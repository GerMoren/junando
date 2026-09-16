import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@junando/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.integration.test.ts'],
    coverage: { enabled: false },
    testTimeout: 15_000,
    hookTimeout: 10_000,
  },
});
