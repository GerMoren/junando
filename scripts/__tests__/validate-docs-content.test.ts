import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateDocsContent } from '../validate-docs-content';

const GITHUB_SOURCE_URL = 'https://github.com/GerMoren/junando/blob/main/README.md';
const SAFE_TOKEN_PLACEHOLDER = '<YOUR_TOKEN>';
const TEMPORARY_DIRECTORY_PREFIX = 'junando-docs-validator-';

const temporaryDirectories: string[] = [];

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), TEMPORARY_DIRECTORY_PREFIX));
  temporaryDirectories.push(root);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = join(root, relativePath);
      await writeFile(filePath, content, 'utf8');
    }),
  );

  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('validateDocsContent', () => {
  it.each(['guide.md', 'guide.mdx', 'README.sh', 'requirements.txt'])('scans %s for unsafe content', async (fileName) => {
    const root = await createFixture({
      [fileName]: `Use ${SAFE_TOKEN_PLACEHOLDER}\nSource: ${GITHUB_SOURCE_URL}\n`,
    });

    await expect(validateDocsContent(root)).resolves.toEqual([]);
  });

  it('reports credential-shaped literals with file and line diagnostics', async () => {
    const root = await createFixture({
      'guide.md': 'Authorization: Bearer super-secret-token-value\n',
    });

    await expect(validateDocsContent(root)).resolves.toEqual([
      expect.objectContaining({ file: 'guide.md', line: 1, kind: 'secret' }),
    ]);
  });

  it('accepts safe placeholders and canonical repository links', async () => {
    const root = await createFixture({
      'guide.md': `Token: ${SAFE_TOKEN_PLACEHOLDER}\n${GITHUB_SOURCE_URL}\n`,
    });

    await expect(validateDocsContent(root)).resolves.toEqual([]);
  });

  it('reports canonical links that do not resolve', async () => {
    const root = await createFixture({
      'guide.md': 'Source: https://github.com/GerMoren/junando/blob/main/not-found.md\n',
    });

    await expect(validateDocsContent(root)).resolves.toEqual([
      expect.objectContaining({ file: 'guide.md', line: 1, kind: 'link' }),
    ]);
  });
});
