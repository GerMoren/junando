# @junando/webhook

## 0.12.0

### Minor Changes

- 6945290: feat(observability): implement wide events / canonical log lines for all pipeline stages

  Replace scattered Pino `logger.info()` calls with one canonical wide event per cluster.
  Each cluster processing produces a single structured JSON line carrying the complete
  pipeline chain: dedup → traces → LLM → notifier.

  **WideEventBuilder** — mutable builder passed through pipeline stages; flush() produces
  the final event with tail sampling and PII redaction.

  **Structured adapter returns** — DedupResult, LLMResult, NotifyResult types feed the
  wide event sections.

  **x-correlation-id** — Webhook accepts upstream correlation ID (UUID-validated).

  **/metrics endpoint** — Worker exposes prom-client registry via Function URL (IAM auth).

  **Documentation** — WIDE-EVENTS.md with philosophy, taxonomy, how-to guide, and LogQL
  query patterns.

  Breaking: IDeduplicationStore.isNew() returns DedupResult instead of boolean.
  ILLMProvider.analyze() returns LLMResult instead of LLMAnalysis.
  INotifier.send() returns NotifyResult instead of void.

### Patch Changes

- Updated dependencies [6945290]
  - @junando/core@0.12.0

## 0.11.1

### Patch Changes

- 3aaa9fd: Migrate the build pipeline from tsup to tsdown to support TypeScript 7.0.2. tsup 8.5.1 bundles rollup-plugin-dts 6.1.1, which cannot load TypeScript 7's ESM-only compiler API. tsdown uses rolldown-plugin-dts with the tsgo generator, restoring `.d.ts` emission and the full monorepo build. Refs #177.
- Updated dependencies [3aaa9fd]
  - @junando/core@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [a5a409c]
- Updated dependencies [a5a409c]
  - @junando/core@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [38423c6]
  - @junando/core@0.10.1

## 0.10.0

### Patch Changes

- @junando/core@0.10.0

## 0.9.0

### Patch Changes

- @junando/core@0.9.0

## 0.8.3

### Patch Changes

- @junando/core@0.8.3

## 0.8.2

### Patch Changes

- Updated dependencies [f69466a]
  - @junando/core@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [66c6701]
  - @junando/core@0.8.1

## 0.8.0

### Patch Changes

- @junando/core@0.8.0
