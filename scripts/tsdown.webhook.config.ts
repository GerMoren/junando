import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { 'webhook-server': 'webhook-server.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  minify: false,
  deps: { alwaysBundle: [/./] },
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  dts: false,
  tsconfig: 'tsconfig.scripts.json',
  outputOptions: { codeSplitting: false },
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
