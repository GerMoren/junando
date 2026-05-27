---
name: junando-release
description: "Trigger: changeset, publish, npm release, version bump in junando. Enforce changeset-per-PR and OIDC publishing flow."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

# Skill: junando-release

## Activation Contract

Activate when working in the `junando` monorepo and any of these is true:
- Editing code under `packages/core`, `packages/ingest`, `packages/webhook`, `packages/worker`, or `packages/create-junando-app`.
- Opening, reviewing, or merging a PR that touches those packages.
- Asked about npm publishing, versioning, changesets, provenance, or OIDC for this repo.
- Investigating why a merged PR did not produce a new npm version.

Do not activate for changes scoped to `docs/`, `dashboards/`, `.github/` only, root configs, or other non-publishable paths.

## Hard Rules

- Every PR that modifies a publishable package MUST include a `.changeset/<slug>.md` file in the same PR. No exceptions for "trivial" bugfixes — without a changeset, nothing publishes.
- Default bump for pre-1.0 (`0.x.y`) is `patch` for bugfixes and internal refactors, even when non-exported types change. Use `minor` only when public exported API gains surface or exported types break. Reserve `major` for post-1.0.
- Inline (non-exported) interfaces gaining overloads = `patch`.
- Never run `changeset publish` manually. Publishing is OIDC-only via the `changeset-publish` workflow. Tokens are emergency fallback only.
- Never push directly to `main`. Never merge PRs autonomously — the maintainer always merges.
- Run `pnpm run lint` and `pnpm test` before every commit on a release-bound branch.

## Decision Gates

| Situation | Action |
|---|---|
| PR touches `packages/<publishable>/src/**` | Add changeset in same PR |
| PR is docs-only, CI-only, or root-config-only | No changeset needed |
| Logger / inline interface gains overload | `patch` |
| New exported function, class, or type | `minor` |
| Removed or renamed export, changed exported signature | `major` (and discuss with maintainer first) |
| Merged feature PR without changeset | Open a follow-up `chore(changeset): ...` PR immediately |
| `changeset-version` PR is open | Merge it to trigger `changeset-publish` |
| Publish workflow fails on OIDC | Check Trusted Publisher config on npmjs (org/user field is case-sensitive: `GerMoren`, not `germoren`) |

## Execution Steps

1. Before opening any PR, check the diff scope. If it touches a publishable package, run `ls .changeset/` and confirm a slug file exists alongside `config.json`.
2. If missing, create `.changeset/<short-slug>.md` with this shape:

   ```markdown
   ---
   '@junando/<package>': patch
   ---

   <One paragraph, problem-first changelog entry. Mention the issue number with "Closes #N" or "Refs #N".>
   ```

3. Stage the changeset in the same commit as the code change, or as a sibling commit on the same branch before opening the PR.
4. Run `pnpm run lint` and `pnpm test` before committing.
5. After the feature PR merges, watch for the auto-opened `chore: version packages` PR from the `changeset-version` workflow. Tell the maintainer it is ready; do not merge it autonomously.
6. After the version PR merges, `changeset-publish` runs with `NPM_CONFIG_PROVENANCE=true` and OIDC. Confirm the new version appears on npmjs with the "GitHub Actions" publisher badge.
7. If a publishable PR was already merged without a changeset, open a `chore(changeset): patch bump for #N <slug>` PR on a fresh branch. Do not attempt to amend or force-push the merged PR.

## Output Contract

When asked to prepare or review a release-bound PR, report:
- Files modified in the diff and which packages are affected.
- Bump level chosen and the reasoning (patch / minor / major).
- Path to the changeset file added.
- Confirmation that lint and tests passed locally.
- Next maintainer action (review, merge feature PR, then merge version PR).

## References

- `references/workflows.md` — details on `changeset-version` and `changeset-publish` workflows, OIDC gotchas, and provenance flags.
