import { describe, it, expect, afterEach } from 'vitest';
import { rewritePackageJson } from '../rewrite-package-json.js';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('rewritePackageJson', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('rewrites name field and preserves other fields', async () => {
    tmpDir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'pkg-test-')));
    const pkgPath = join(tmpDir, 'package.json');
    await writeFile(pkgPath, JSON.stringify({ name: 'old-name', version: '1.0.0', description: 'test' }, null, 2) + '\n');

    await rewritePackageJson(pkgPath, pkg => ({ ...(pkg as object), name: 'new-name' }));

    const result = JSON.parse(await readFile(pkgPath, 'utf-8')) as { name: string; version: string; description: string };
    expect(result.name).toBe('new-name');
    expect(result.version).toBe('1.0.0');
    expect(result.description).toBe('test');
  });

  it('writes with 2-space indent and trailing newline', async () => {
    tmpDir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'pkg-test-')));
    const pkgPath = join(tmpDir, 'package.json');
    await writeFile(pkgPath, JSON.stringify({ name: 'test' }, null, 2) + '\n');

    await rewritePackageJson(pkgPath, pkg => pkg);

    const raw = await readFile(pkgPath, 'utf-8');
    expect(raw).toMatch(/  "/); // 2-space indent
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('throws when file does not exist', async () => {
    await expect(rewritePackageJson('/nonexistent/package.json', pkg => pkg)).rejects.toThrow();
  });
});
