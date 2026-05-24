#!/usr/bin/env node
/**
 * Verifies that every publishable package has the required fields
 * and that the dist/ folder exists after build.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PACKAGES = ["core", "ingest", "webhook", "worker", "create-junando-app"];
const REQUIRED_FIELDS = ["name", "version", "description", "license", "main", "files", "repository", "publishConfig"];

let failed = false;

for (const pkg of PACKAGES) {
  const pkgPath = resolve(root, "packages", pkg, "package.json");
  const json = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const distPath = resolve(root, "packages", pkg, "dist");
  const displayName = pkg === "create-junando-app" ? "create-junando-app" : `@junando/${pkg}`;

  console.log(`\n📦 ${displayName}`);

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!json[field]) {
      console.error(`  ❌ Missing field: ${field}`);
      failed = true;
    } else {
      console.log(`  ✅ ${field}: ${JSON.stringify(json[field]).slice(0, 60)}`);
    }
  }

  // Check dist exists
  if (!existsSync(distPath)) {
    console.error(`  ❌ dist/ folder not found — run build first`);
    failed = true;
  } else {
    console.log(`  ✅ dist/ exists`);
  }
}

if (failed) {
  console.error("\n✖ Verification failed. Fix the errors above before publishing.\n");
  process.exit(1);
} else {
  console.log("\n✔ All packages verified. Ready to publish.\n");
}
