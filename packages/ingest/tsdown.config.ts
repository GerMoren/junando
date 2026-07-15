import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/adapters/loki/loki-http-client.ts'],
  format: ['esm', 'cjs'],
  // dts disabled — generate separately with tsc (tsgo/oxc/tsc all break with
  // bundled workspace deps under TS7). See postbuild script below.
  dts: false,
  tsconfig: 'tsconfig.build.json',
  fixedExtension: false,
});
