import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig.base.json paths so vitest resolves workspace packages
      // from source without needing built dist/ artifacts.
      '@junando/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@junando/ingest': resolve(__dirname, 'packages/ingest/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'packages/cdk/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
