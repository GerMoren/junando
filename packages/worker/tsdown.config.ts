import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/handler.ts'],
  format: 'cjs',
  // Tree-shaking is intentionally disabled to avoid a Rolldown panic with the
  // `DEDUP_TTL_MS_MULTIPLIER` symbol. See: https://github.com/rolldown/rolldown/issues
  treeshake: false,
  sourcemap: false,
  minify: false,
  platform: 'node',
  target: 'node22',
  dts: false,
  fixedExtension: false,
  deps: { alwaysBundle: [/./] },
});
