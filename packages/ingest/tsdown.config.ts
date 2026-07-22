import { existsSync } from 'node:fs';
import { defineConfig } from 'tsdown';

// @junando/core is a workspace devDependency that this package intentionally
// BUNDLES into dist — consumers don't install it separately (see src/index.ts).
// At install time (prepare script) core's dist/ doesn't exist yet, so rolldown
// emits UNRESOLVED_IMPORT warnings and falls back to treating it as external.
// Mark it external only in that case: real builds (core built first) still
// bundle it, and install-time logs stay clean.
// Resolve relative to this config file (via import.meta.url), NOT process.cwd(),
// so the check is stable no matter where tsdown is invoked from.
const coreDistMissing = !existsSync(new URL('../core/dist/index.js', import.meta.url));

export default defineConfig({
  entry: ['src/index.ts', 'src/adapters/loki/loki-http-client.ts'],
  format: ['esm', 'cjs'],
  // dts disabled — generate separately with tsc (tsgo/oxc/tsc all break with
  // bundled workspace deps under TS7). See postbuild script below.
  dts: false,
  tsconfig: 'tsconfig.build.json',
  fixedExtension: false,
  deps: {
    neverBundle: coreDistMissing ? ['@junando/core'] : [],
  },
});
