import { describe, it, expect, afterEach } from 'vitest';
import { scaffold } from '../scaffold.js';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function createSyntheticTemplate(dir: string): Promise<void> {
  await mkdir(join(dir, 'app'), { recursive: true });
  await writeFile(
    join(dir, 'app', 'package.json'),
    JSON.stringify({ name: 'template-app', version: '0.0.0' }, null, 2) + '\n',
  );
  await writeFile(join(dir, '.env.example'), 'PORT=3001\n');
  await writeFile(join(dir, 'docker-compose.yml'), 'version: "3"\n');
}

describe('scaffold', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('copies all template files to target dir', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'scaffold-test-'));
    const templateDir = join(tmpDir, 'template');
    const targetDir = join(tmpDir, 'output', 'my-project');
    await mkdir(templateDir, { recursive: true });
    await createSyntheticTemplate(templateDir);

    await scaffold({ targetDir, projectName: 'my-project', templateDir, skipInstall: true });

    await expect(access(join(targetDir, 'app', 'package.json'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, '.env.example'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, 'docker-compose.yml'))).resolves.toBeUndefined();
  });

  it('rewrites app/package.json name to projectName', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'scaffold-test-'));
    const templateDir = join(tmpDir, 'template');
    const targetDir = join(tmpDir, 'output', 'my-app');
    await mkdir(templateDir, { recursive: true });
    await createSyntheticTemplate(templateDir);

    await scaffold({ targetDir, projectName: 'my-app', templateDir, skipInstall: true });

    const pkg = JSON.parse(await readFile(join(targetDir, 'app', 'package.json'), 'utf-8')) as { name: string };
    expect(pkg.name).toBe('my-app');
  });

  it('throws if target dir already exists and is non-empty', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'scaffold-test-'));
    const templateDir = join(tmpDir, 'template');
    const targetDir = join(tmpDir, 'existing-dir');
    await mkdir(templateDir, { recursive: true });
    await createSyntheticTemplate(templateDir);
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, 'somefile.txt'), 'content');

    await expect(scaffold({ targetDir, projectName: 'my-app', templateDir, skipInstall: true })).rejects.toThrow();
  });

  it('renames _gitignore to .gitignore in scaffolded output (npm publish workaround)', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'scaffold-test-'));
    const templateDir = join(tmpDir, 'template');
    const targetDir = join(tmpDir, 'output', 'my-app');
    await mkdir(templateDir, { recursive: true });
    await createSyntheticTemplate(templateDir);
    await writeFile(join(templateDir, '_gitignore'), 'node_modules\n.env\n');

    await scaffold({ targetDir, projectName: 'my-app', templateDir, skipInstall: true });

    await expect(access(join(targetDir, '.gitignore'))).resolves.toBeUndefined();
    await expect(access(join(targetDir, '_gitignore'))).rejects.toThrow();
    const contents = await readFile(join(targetDir, '.gitignore'), 'utf-8');
    expect(contents).toContain('node_modules');
    expect(contents).toContain('.env');
  });
});
