import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/shared/metrics/index.ts'],
  format: 'esm',
  dts: true,
  tsconfig: 'tsconfig.build.json',
  fixedExtension: false,
  deps: { skipNodeModulesBundle: true },
});
