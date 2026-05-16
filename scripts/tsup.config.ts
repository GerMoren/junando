import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'webhook-server': 'webhook-server.ts',
    'worker-server': 'worker-server.ts',
  },
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  sourcemap: false,
  minify: false,
  // Bundle all dependencies into self-contained CJS files for Docker COPY
  noExternal: [/./],
  outDir: 'dist',
});
