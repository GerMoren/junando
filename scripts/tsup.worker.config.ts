import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'worker-server': 'worker-server.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  minify: false,
  noExternal: [/./],
  outDir: 'dist',
  splitting: false,
  outExtension: () => ({ js: '.mjs' }),
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
