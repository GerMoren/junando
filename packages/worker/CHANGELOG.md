# @junando/worker

## 0.10.0

### Minor Changes

- 56c6495: feat(worker): add CSV input adapter for SQS messages from external monitoring tools.

  The adapter auto-detects CSV bodies in SQS messages and parses them into `NormalizedAlert[]` using configurable column mapping via env vars (`CSV_SERVICE_COL`, `CSV_MESSAGE_COL`, `CSV_SEVERITY_COL`, `CSV_TIMESTAMP_COL`, `CSV_FINGERPRINT_COL`, `CSV_ENDPOINT_COL`, `CSV_EXTRA_LABELS`). Falls back to JSON when the body is not valid CSV. Closes #20.

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
