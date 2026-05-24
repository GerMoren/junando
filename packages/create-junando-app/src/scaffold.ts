import { cp, readdir, rename, access, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { rewritePackageJson } from './helpers/rewrite-package-json.js';

export interface ScaffoldOptions {
  targetDir: string;
  projectName: string;
  templateDir: string;
  skipInstall?: boolean;
}

export async function scaffold({
  targetDir,
  projectName,
  templateDir,
  skipInstall = false,
}: ScaffoldOptions): Promise<void> {
  // Check if target dir exists and is non-empty (only treat ENOENT as "missing")
  let entries: string[] = [];
  try {
    entries = await readdir(targetDir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw err;
    }
  }
  if (entries.length > 0) {
    throw new Error(
      `Target directory "${targetDir}" already exists and is non-empty. Remove it first or choose a different name.`,
    );
  }

  // Copy template → target
  await cp(templateDir, targetDir, { recursive: true });

  // Rename app/_gitignore → app/.gitignore (workaround for npm stripping .gitignore on publish).
  // Lives in app/ because that's where the user runs `git init` after scaffolding.
  const renamedGitignore = join(targetDir, 'app', '_gitignore');
  try {
    await access(renamedGitignore);
    await rename(renamedGitignore, join(targetDir, 'app', '.gitignore'));
  } catch {
    // No app/_gitignore in template — fine.
  }

  // Copy app/.env.example → app/.env so `pnpm dev` (which uses --env-file=.env)
  // works out of the box. Do not overwrite if .env already exists.
  const envExample = join(targetDir, 'app', '.env.example');
  const envFile = join(targetDir, 'app', '.env');
  try {
    await access(envExample);
    let envExists = false;
    try {
      await access(envFile);
      envExists = true;
    } catch {
      // .env missing — that's the expected case.
    }
    if (!envExists) {
      await copyFile(envExample, envFile);
    }
  } catch {
    // No app/.env.example in template — fine.
  }

  // Rewrite app/package.json name
  const pkgPath = join(targetDir, 'app', 'package.json');
  await rewritePackageJson(pkgPath, (pkg) => ({ ...(pkg as object), name: projectName }));

  if (!skipInstall) {
    await runPnpmInstall(join(targetDir, 'app'));
  }
}

function runPnpmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install'], { cwd, stdio: 'inherit', shell: false });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new Error('pnpm not found on PATH. Install pnpm (https://pnpm.io/installation) and try again.'));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pnpm install exited with code ${String(code)}`));
      }
    });
  });
}
