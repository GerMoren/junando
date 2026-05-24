#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './helpers/parse-args.js';
import { isValidProjectName } from './helpers/validate-name.js';
import { scaffold } from './scaffold.js';
import { buildNextStepsMessage } from './helpers/next-steps.js';

const pkgUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version: string };
const VERSION = pkg.version;

const USAGE = `
Usage:
  pnpm create junando-app <project-name>
  npx create-junando-app <project-name>

Arguments:
  project-name    Name of the new project directory

Options:
  --help, -h      Show this help message
  --version, -v   Show version number
`.trim();

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function die(msg: string): never {
  process.stderr.write(`${RED}Error: ${msg}${RESET}\n`);
  process.exit(1);
}

const parsed = parseArgs(process.argv);

if (parsed.help) {
  console.log(USAGE);
  process.exit(0);
}

if (parsed.version) {
  console.log(VERSION);
  process.exit(0);
}

if (parsed.unknownFlag !== undefined) {
  die(`Unknown flag: ${parsed.unknownFlag}\n\n${USAGE}`);
}

if (parsed.projectName === undefined) {
  process.stderr.write(USAGE + '\n');
  process.exit(1);
}

const targetDir = parsed.projectName;
const projectName = basename(targetDir);

if (targetDir.split(/[\\/]/).includes('..')) {
  die(`Target path "${targetDir}" must not contain ".." segments.`);
}

if (!isValidProjectName(projectName)) {
  die(
    `Invalid project name "${projectName}". ` +
      'Use letters, digits, dots, hyphens, or underscores; must start with a letter or digit.',
  );
}

const templateDirUrl = new URL('../template/', import.meta.url);
const templateDir = fileURLToPath(templateDirUrl);

if (!existsSync(templateDir)) {
  die(
    `Template directory not found at ${templateDir}. ` +
      'This is likely a broken install — try reinstalling create-junando-app.',
  );
}

(async () => {
  try {
    await scaffold({ targetDir, projectName, templateDir });
    process.stdout.write(buildNextStepsMessage(targetDir));
  } catch (err: unknown) {
    die(err instanceof Error ? err.message : String(err));
  }
})();
