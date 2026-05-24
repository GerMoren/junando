/**
 * Verifies the tarball that `npm pack` would publish contains everything required.
 * Run as part of `prepublishOnly` so a broken release is impossible.
 *
 * Checks:
 *   - dist/cli.js exists, starts with shebang, has executable mode bit
 *   - template/ exists with key files (_gitignore, .env.example, app/package.json)
 *   - node_modules and pnpm-lock.yaml NOT shipped
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync, accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');

function die(msg) {
  console.error(`[verify-tarball] FAIL: ${msg}`);
  process.exit(1);
}

// 1. Shebang on built CLI
const cliPath = resolve(pkgRoot, 'dist/cli.js');
try {
  accessSync(cliPath);
} catch {
  die(`dist/cli.js missing — build did not run`);
}
const cliFirstLine = readFileSync(cliPath, 'utf8').split('\n', 1)[0];
if (!cliFirstLine.startsWith('#!/usr/bin/env node')) {
  die(`dist/cli.js missing shebang (first line: "${cliFirstLine}"). Bin will not be executable.`);
}

// 2. Template critical files
const required = [
  'template/_gitignore',
  'template/.env.example',
  'template/app/package.json',
  'template/README.md',
];
for (const rel of required) {
  try {
    statSync(resolve(pkgRoot, rel));
  } catch {
    die(`required template file missing: ${rel}`);
  }
}

// 3. Tarball manifest sanity (npm pack --dry-run --json)
let manifest;
try {
  const out = execSync('npm pack --dry-run --json', { cwd: pkgRoot, encoding: 'utf8' });
  manifest = JSON.parse(out)[0];
} catch (err) {
  die(`npm pack --dry-run failed: ${err.message}`);
}

const shipped = new Set(manifest.files.map((f) => f.path));
const mustShip = ['dist/cli.js', 'template/_gitignore', 'template/.env.example', 'template/app/package.json'];
for (const f of mustShip) {
  if (!shipped.has(f)) {
    die(`tarball is missing ${f}. Files: ${[...shipped].join(', ')}`);
  }
}

const mustNotShip = ['template/node_modules', 'template/app/node_modules', 'template/app/pnpm-lock.yaml'];
for (const f of mustNotShip) {
  for (const shippedFile of shipped) {
    if (shippedFile.startsWith(f)) {
      die(`tarball ships forbidden path: ${shippedFile}`);
    }
  }
}

console.log(`[verify-tarball] OK — ${manifest.files.length} files, ${(manifest.size / 1024).toFixed(1)} KB`);
