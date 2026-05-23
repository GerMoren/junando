import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  // Bundle @junando/core into the dist so external consumers
  // (e.g. pnpm add @junando/ingest) don't need to resolve workspace:* deps.
  noExternal: ['@junando/core'],
});
