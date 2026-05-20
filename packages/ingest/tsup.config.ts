import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  // Bundle @junando/core into the dist so external consumers
  // (e.g. pnpm add git+https://...) don't need to resolve workspace:* deps.
  noExternal: ['@junando/core'],
});
