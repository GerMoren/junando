# References: junando release workflows

## Workflows

- `.github/workflows/changeset-version.yml`
  - Triggers on push to `main`.
  - Runs `pnpm run version:packages` (chained script in root `package.json` — NOT inline shell, because `changesets/action@v1` parses `version:` as a single command).
  - Opens or updates a PR titled `chore: version packages` that bumps versions and regenerates `CHANGELOG.md`.

- `.github/workflows/changeset-publish.yml`
  - Triggers when the version PR merges into `main`.
  - OIDC-only. Uses `NPM_CONFIG_PROVENANCE: 'true'` as an env var (NOT `--provenance` flag — `changeset publish` does not accept it).
  - Publishes every package whose `version` changed.
  - `NPM_TOKEN` exists as a secret only for emergency fallback; do not rely on it.

## OIDC gotchas

- Each publishable package needs its own Trusted Publisher entry on npmjs.
- The org/user field is case-sensitive: `GerMoren`, not `germoren`. Wrong case = silent OIDC rejection.
- Repository field: `GerMoren/junando`.
- Workflow filename field: `changeset-publish.yml` (exact, no path prefix).
- Environment field: leave empty (we don't use environment protection for this).

## Verification

After a publish run, check:
1. `gh run list --workflow=changeset-publish.yml --limit=1` shows success.
2. npmjs.com/package/@junando/<pkg> shows the new version with publisher "GitHub Actions" and a provenance badge.
3. `npm view @junando/<pkg> dist-tags.latest` returns the new version.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Merged feature PR, no version PR appeared | No changeset in the PR | Open a `chore(changeset)` follow-up PR |
| Version PR opened but publish workflow didn't run | Maintainer hasn't merged version PR yet | Wait for merge |
| Publish workflow fails with OIDC error | Case mismatch in Trusted Publisher config | Fix case on npmjs.com |
| Publish runs but no provenance badge | Missing `NPM_CONFIG_PROVENANCE: 'true'` env | Add env to workflow |
