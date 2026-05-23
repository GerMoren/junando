# API Stability Policy

Junando follows [Semantic Versioning 2.0.0](https://semver.org/) for all `@junando/*` packages on npm. This document defines what we consider public API, the stability tiers we use, and how we manage breaking changes.

---

## What is public API

A symbol is **public API** if and only if it is reachable from a documented entry point declared in a package's `exports` field.

| Package            | Public entry points                                                | Audience                    |
|--------------------|--------------------------------------------------------------------|-----------------------------|
| `@junando/core`    | `@junando/core`, `@junando/core/shared/metrics`                    | Library consumers           |
| `@junando/ingest`  | `@junando/ingest`, `@junando/ingest/loki-http-client`              | Library consumers           |
| `@junando/webhook` | None (deployable Lambda handler)                                   | AWS Lambda runtime          |
| `@junando/worker`  | None (deployable Lambda handler)                                   | AWS Lambda runtime          |

Anything reachable only through deep imports (e.g. `@junando/core/dist/internal/...`) is **private** and may change in any release without notice.

The `development` condition in `exports` (which points to `./src/...`) exists for monorepo dogfooding only. Consumers must rely on the default condition. Importing from `src/` paths in published packages is unsupported.

---

## Stability tiers

Every public symbol is one of:

### Stable

- Safe to depend on across minor and patch releases.
- Breaking changes require a major version bump and a deprecation window (see below).
- Default tier for anything exported and not explicitly marked otherwise.

### Experimental

- May change shape, signature, or be removed in any minor release.
- Marked with `@experimental` in TSDoc and called out in the changelog when introduced.
- Use in production at your own risk.

### Deprecated

- Still works but scheduled for removal.
- Marked with `@deprecated` in TSDoc, including the replacement and the earliest version that will remove it.
- Deprecation appears in changelog when introduced and in the release notes of every version until removal.

---

## SemVer rules for this project

`MAJOR.MINOR.PATCH`:

- **MAJOR** — breaking change to any stable public API, or removal of a deprecated symbol whose window has elapsed.
- **MINOR** — new public APIs, new optional fields, behavior changes that preserve existing contracts, new experimental APIs, new deprecations.
- **PATCH** — bug fixes, dependency bumps that do not change behavior, documentation, internal refactors.

A breaking change includes:

- Removing or renaming an exported symbol.
- Changing a function signature (parameter type, return type, required vs optional).
- Removing or narrowing a public type field.
- Tightening runtime validation (e.g. Zod schema) in a way that rejects previously valid input.
- Changing default behavior of a stable function in a way that requires consumer code changes.
- Bumping the required Node.js engine.

A change is **not** breaking if it only affects:

- Private symbols (anything not in `exports`).
- Experimental APIs.
- Lambda handler runtime behavior in `@junando/webhook` or `@junando/worker` (these are not library APIs).

---

## Deprecation window

Before a stable API is removed:

1. The symbol must be marked `@deprecated` in at least one **minor** release before the major bump that removes it.
2. The deprecation must be listed in `CHANGELOG.md` under `### Deprecated` for the release that introduces it.
3. The replacement, if any, must be available in the same release.

Minimum window: **one minor release**. Longer is preferred for widely used APIs.

---

## Pre-1.0 caveat

All `@junando/*` packages are currently in the `0.x.y` range. Per SemVer:

> Anything MAY change at any time. The public API SHOULD NOT be considered stable.

In practice, this project treats `0.MINOR.PATCH` like a normal SemVer line:

- `0.x.0` may include breaking changes — these are called out in `CHANGELOG.md` under `### Changed` with a **BREAKING** prefix.
- `0.x.y` patches stay backward compatible.

When the project reaches `1.0.0`, full SemVer guarantees apply.

---

## Changelog conventions

`CHANGELOG.md` at the repo root follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Entries land under `## [Unreleased]` and are grouped:

- `### Added` — new public APIs or features.
- `### Changed` — behavior changes to existing APIs (prefix breaking ones with **BREAKING:**).
- `### Deprecated` — APIs marked for removal in a future major.
- `### Removed` — APIs removed after their deprecation window.
- `### Fixed` — bug fixes.
- `### Security` — security-relevant changes.

On release, `[Unreleased]` is renamed to `[X.Y.Z] - YYYY-MM-DD` and a fresh `[Unreleased]` block is added.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` → minor bump.
- `fix:` → patch bump.
- `feat!:` or `fix!:` (or `BREAKING CHANGE:` footer) → major bump.
- `docs:`, `chore:`, `refactor:`, `test:`, `ci:` → no version impact.

---

## Marking APIs in code

Use TSDoc tags so consumers see stability in their editor:

```ts
/**
 * Process an incoming alert cluster.
 *
 * @public
 * @stable
 */
export class ProcessIncidentUseCase { /* ... */ }

/**
 * Experimental webhook for vendor-specific payloads.
 *
 * @public
 * @experimental May change or be removed in any minor release.
 */
export function processVendorWebhook(/* ... */) { /* ... */ }

/**
 * @public
 * @deprecated since 0.7.0 — use `createNotifier` instead. Will be removed in 1.0.0.
 */
export function buildNotifier(/* ... */) { /* ... */ }
```

---

## Reporting a breaking change you did not expect

If you depend on a published `@junando/*` package and a non-major release broke you, open an issue with the `type:bug` and `priority:high` labels. Include the package, both versions, and the minimal reproduction. Unintentional breakages will be reverted in a patch release.
