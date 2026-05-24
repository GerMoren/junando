import { cp, rm, access, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const exampleDir = resolve(pkgRoot, '../../examples/express-end-to-end');
const templateDir = join(pkgRoot, 'template');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Remove existing template dir
if (await exists(templateDir)) {
  await rm(templateDir, { recursive: true, force: true });
  console.log('[sync-template] Removed existing template/');
}

// Copy example → template
await cp(exampleDir, templateDir, { recursive: true });
console.log(`[sync-template] Copied ${exampleDir} → ${templateDir}`);

// Strip node_modules and pnpm-lock.yaml if present
const nmDir = join(templateDir, 'app', 'node_modules');
const lockFile = join(templateDir, 'app', 'pnpm-lock.yaml');

if (await exists(nmDir)) {
  await rm(nmDir, { recursive: true, force: true });
  console.log('[sync-template] Removed template/app/node_modules');
}
if (await exists(lockFile)) {
  await rm(lockFile, { force: true });
  console.log('[sync-template] Removed template/app/pnpm-lock.yaml');
}

// CRITICAL: npm strips any .gitignore from published tarballs.
// Rename to _gitignore so it survives publish; scaffold renames it back on copy.
const gitignoreSrc = join(templateDir, '.gitignore');
const gitignoreDst = join(templateDir, '_gitignore');
if (await exists(gitignoreSrc)) {
  await rename(gitignoreSrc, gitignoreDst);
  console.log('[sync-template] Renamed .gitignore → _gitignore (npm publish workaround)');
}

console.log('[sync-template] Done.');
