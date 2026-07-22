import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type DocsValidationKind = 'secret' | 'link';

export interface DocsValidationFinding {
  file: string;
  line: number;
  kind: DocsValidationKind;
  message: string;
}

const PUBLISHED_FILE_EXTENSIONS = new Set(['.md', '.mdx', '.sh', '.txt']);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~-]{12,}/i,
  /\b(?:api[_-]?key|access[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9/+._~-]{16,}/i,
  /https?:\/\/[^\s/@]+:[^\s/@]+@/i,
];
const SAFE_PLACEHOLDER_PATTERN = /^<YOUR_[A-Z0-9_]+>$/;
const CANONICAL_LINK_PATTERN = /https:\/\/github\.com\/GerMoren\/junando\/blob\/main\/([^\s)#]+)/g;

function isPublishedFile(fileName: string): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return PUBLISHED_FILE_EXTENSIONS.has(extension) || fileName === 'README.sh';
}

async function collectPublishedFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectPublishedFiles(root, path);
      return isPublishedFile(entry.name) ? [path] : [];
    }),
  );
  return nestedFiles.flat();
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function findSecrets(line: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(line) && !SAFE_PLACEHOLDER_PATTERN.test(line.trim()));
}

async function canonicalLinkExists(repoRoot: string, target: string): Promise<boolean> {
  try {
    await access(join(repoRoot, target));
    return true;
  } catch {
    return false;
  }
}

export async function validateDocsContent(root: string, repoRoot = process.cwd()): Promise<DocsValidationFinding[]> {
  const files = await collectPublishedFiles(root);
  const findings: DocsValidationFinding[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativeFile = relative(root, file);
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      if (findSecrets(line)) {
        findings.push({
          file: relativeFile,
          line: index + 1,
          kind: 'secret',
          message: 'credential-shaped literal found; use a safe placeholder',
        });
      }
    });

    const links = [...source.matchAll(CANONICAL_LINK_PATTERN)];
    for (const link of links) {
      const target = link[1];
      if (target && !(await canonicalLinkExists(repoRoot, target))) {
        findings.push({
          file: relativeFile,
          line: lineNumberAt(source, link.index ?? 0),
          kind: 'link',
          message: `canonical repository link does not resolve: ${target}`,
        });
      }
    }
  }

  return findings;
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? join(process.cwd(), 'apps/docs/src/content/docs');
  const findings = await validateDocsContent(root);
  findings.forEach((finding) => console.error(`${finding.file}:${finding.line} [${finding.kind}] ${finding.message}`));
  if (findings.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
