import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/handler.ts'],
  format: 'cjs',
  treeshake: true,
  sourcemap: false,
  minify: false,
  platform: 'node',
  target: 'node22',
  // Force bundling of ALL dependencies for a self-contained Lambda zip
  noExternal: [/./],
});
