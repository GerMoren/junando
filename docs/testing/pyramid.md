# Testing Pyramid & Quality Gates

This document defines how Junando organizes tests, what each layer is responsible for, and the minimum quality gates a contribution must meet before it lands.

It is descriptive of what we already do, not aspirational. Every rule below is enforced by current code or CI.

## TL;DR

- 3 layers: **unit → integration → e2e**.
- One test runner: **vitest**. One config: `vitest.config.ts` at the repo root.
- Files end in `*.test.ts`; e2e files end in `*.e2e.test.ts`.
- Tests live in `__tests__/` colocated with the source they cover.
- Coverage floor: **80/80/80/80** (lines/statements/branches/functions). Current global coverage is ~95/95/87/92 — do not regress.

## Layers

### Unit

A unit test exercises a single function, value object, or class with all collaborators replaced by `vi.fn()` stubs or hand-rolled fakes. No filesystem, no SDK clients, no other modules of ours wired in.

**When to write one:** every pure function, every domain entity, every value object, every utility, every shared helper.

**Examples in the repo:**
- `packages/core/src/domain/value-objects/__tests__/fingerprint.test.ts`
- `packages/core/src/application/dtos/__tests__/normalize-payload.test.ts`
- `packages/core/src/application/use-cases/__tests__/process-incident.use-case.test.ts`
- `packages/webhook/src/__tests__/handler.test.ts`
- `packages/cdk/lib/__tests__/resolve-deploy-config.test.ts`

### Integration

An integration test wires several of our modules together and replaces only the outermost boundary (AWS SDK, Redis client, HTTP transport, file system). The point is to prove that the seams between our modules hold, including serialization, error mapping, and retry behavior.

We use two patterns and both are accepted:
- `vi.mock()` + `vi.hoisted()` for SDK / library boundaries.
- Hand-written in-memory implementations of our own ports (the pattern used in E2E) when the test wants to exercise more than one of our modules at once.

**When to write one:** every infrastructure adapter, every Lambda handler whose unit test alone would have to mock too much of our own code, every CLI subcommand or processor.

**Examples in the repo:**
- `packages/core/src/infrastructure/queue/__tests__/sqs.adapter.test.ts`
- `packages/core/src/infrastructure/dedup/__tests__/redis-dedup.adapter.test.ts`
- `packages/core/src/infrastructure/notifier/__tests__/slack.adapter.test.ts`
- `packages/ingest/src/polling/__tests__/ingest-runner.test.ts`
- `scripts/ingest/processors/__tests__/cenco-phase-a.processor.test.ts`

### E2E

An e2e test drives the **full pipeline** of a use case (clustering → dedup → traces → LLM → notifier for incident processing) with deterministic in-memory implementations of every port. No docker, no network, no credentials. CI runs them as part of the regular `pnpm test` invocation.

The contract:
- Fixtures live in `__tests__/e2e/fixtures/` and are typed objects (not JSON).
- In-memory port implementations live in `__tests__/e2e/helpers/`.
- Assertions check observable outcomes (what reached the notifier, what was stored in dedup), not internal call counts.

**Reference implementation:** `packages/core/src/__tests__/e2e/scenarios.e2e.test.ts`. Read it before adding a new scenario.

**When to write one:** every use case in `packages/core/src/application/use-cases/`, every full webhook → SQS → worker path, every ingest source-to-sink loop.

## Quality Gates

These are the minimums a PR must meet. Reviewers will block on any missing.

### Per layer

| Layer | Minimum bar |
|-------|-------------|
| Unit  | Every public function in `domain/` and every pure helper in `application/dtos/` and `shared/` has a unit test that covers happy path + at least one failure path. |
| Integration | Every adapter under `packages/core/src/infrastructure/` has an integration test that mocks only the external SDK/client, not our own code. |
| E2E   | Every use case under `packages/core/src/application/use-cases/` has at least one e2e scenario in `packages/core/src/__tests__/e2e/`. |

### Per package

| Package | Current state | Required next test added with new code |
|---------|---------------|----------------------------------------|
| `packages/core` | Strong at all 3 layers | Keep adding e2e scenarios alongside new use cases. |
| `packages/webhook` | Unit + integration | An integration test of the full Lambda handler is required for new request shapes. |
| `packages/worker` | Unit only | New behaviour must add an integration test wiring `ProcessIncidentUseCase` with `MockNotifier`. |
| `packages/ingest` | Strong integration | New ingest sources must add an integration test covering the polling → mapping → publish loop. |
| `packages/cdk` | Unit on config resolution | New stacks must add a synth-snapshot test. |
| `scripts/` | Integration tests exist but are excluded from coverage thresholds | Tests still required; coverage is informational here. |

### Coverage thresholds

The root `vitest.config.ts` enforces **80% lines, 80% statements, 80% branches, 80% functions** globally. A PR that pushes any number below 80 fails CI.

Per-layer floors are not enforced by the tool but reviewers will reject a PR whose only new coverage comes from one layer when the change clearly demanded more (for example, a new adapter shipped with only unit tests).

## Conventions

These are not aspirations. The repo is already 100% consistent on each of them.

- **File names:** `*.test.ts` for unit and integration, `*.e2e.test.ts` for e2e. No `*.spec.ts`.
- **Folder:** `__tests__/` colocated with the source being tested.
- **Imports:** relative paths with the `.js` suffix (matches the ESM-with-TS layout used everywhere else in the repo).
- **Mocking split:**
  - Unit → `vi.fn()` and hand-rolled stubs.
  - Integration → `vi.mock()` + `vi.hoisted()` at the SDK boundary only.
  - E2E → hand-written in-memory port implementations under `__tests__/e2e/helpers/`. No `vi.mock` calls in e2e files.
- **Loggers in tests:** use a silent pino logger (`pino({ level: 'silent' })`) instead of a hand-rolled stub — it supports `.child()` and other methods we actually call.
- **Time and randomness:** any test that depends on `Date.now()` or `crypto.randomUUID()` must inject the dependency or use `vi.useFakeTimers()` / a seeded value.

## Adding a New Test

1. Decide the layer by asking: *what am I proving?*
   - A function returns the right value for an input → unit.
   - An adapter calls the SDK with the right shape and maps responses correctly → integration.
   - A use case produces the right side effects end to end → e2e.
2. Find the closest existing test in the same package and copy its structure. Consistency beats novelty.
3. Run only your file while iterating: `pnpm vitest run path/to/your.test.ts`.
4. Before pushing, run `pnpm test` and `pnpm typecheck` locally. Both must be green.
5. If you added an e2e scenario, also run `pnpm vitest run packages/core/src/__tests__/e2e` to confirm it stays under the 5-second budget for the whole e2e suite.

## CI

- `pnpm test` runs the full suite — unit, integration, and e2e — in one job. There is no separate e2e workflow.
- `pnpm typecheck` runs `tsc --noEmit` on the workspace and type-checks the NestJS snippets.
- `pnpm docs:compat:check` regenerates the compatibility matrix and fails if the committed file is stale.
- The quickstart smoke job exercises the demo flow end to end; treat it as a sanity check, not a substitute for unit/integration tests.

If `pnpm test` or `pnpm typecheck` fails locally, do not push.
