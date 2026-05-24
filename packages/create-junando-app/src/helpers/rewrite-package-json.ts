import { readFile, writeFile } from 'node:fs/promises';

export async function rewritePackageJson(
  path: string,
  mutate: (pkg: object) => object,
): Promise<void> {
  const raw = await readFile(path, 'utf-8');
  const pkg = JSON.parse(raw) as object;
  const updated = mutate(pkg);
  await writeFile(path, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
}
