# @junando/ingest

## 0.10.1

### Patch Changes

- 38423c6: refactor: replace all switch/case with maps and FactoryRegistry.

  Zero switch/case statements remaining in the codebase. Added FactoryRegistry generic class in shared/factory-registry.ts for adapter resolution. Refactored notifier factory, metric-to-alert.mapper evaluate() function, and sqs-subscriber test helpers to use map patterns instead of switch/case. Closes #137.

## 0.10.0

## 0.9.0

### Minor Changes

- 0507393: Add transport-agnostic `IngestService` entry point for processing already-normalized alerts. The new `IngestService` class accepts an injected `IncidentProcessor` and exposes `process(alert, options?)` with configurable pipeline stages (`enableLlmAnalysis`, `enableNotifications`, `enableTraceabilityIndexing`). This decouples `@junando/ingest` from `@junando/core` and allows Junando to run on any transport (SQS, HTTP, cron) without mandating SNS/SQS topology. Closes #127.

## 0.8.3

### Patch Changes

- 03da3ef: Emit structured errors with stack trace and step context in `SqsSubscriber`.

  The 4 catch blocks now log via Pino's object-first contract (`logger.error({ err, step, ... }, msg)`) instead of string interpolation. The original `Error` instance reaches the log, so the stack trace is preserved and the failed step (`receive`, `delete`, `processMessage`, `index`) becomes a queryable field. Index failures were promoted from `warn` to `error` because a broken traceability chain is operationally severe. Closes #128.

## 0.8.2

## 0.8.1

## 0.8.0

### Minor Changes

- 33692b3: feat(observability): SLI dashboards, metrics instrumentation, and Prometheus ingestion

  Observability-focused release that pairs end-to-end metric emission with a
  provisioned Grafana dashboard and adds Prometheus as a first-class alert
  source via the new metrics ingestion adapter family.

  ## Grafana SLI dashboard pack (#78, #114)
  - New `Junando SLIs` dashboard (`docs/dashboards/junando-slis.json`),
    provisioned automatically via the compose Grafana stack.
  - 4 panels: ingest latency p95, dedup ratio, incident throughput,
    notification outcomes.
  - Cloud import instructions in `docs/dashboards/README.md`.

  ## Metrics instrumentation (#101, #102, #103, #104)
  - Webhook handler now observes `junando_webhook_duration_seconds` with
    SLI buckets and a `status` label (#101).
  - Worker handler increments `junando_alerts_processed_total{result}` on
    every processed batch (#102).
  - Slack and Teams adapters emit
    `junando_notifications_total{channel,outcome}` per send attempt (#103).
  - New `startSqsLagPoller` exported from `@junando/core` and wired in the
    worker — emits `junando_sqs_queue_lag{queue_name}` (#104).
  - New dedup counter pair (`junando_dedup_new_total` /
    `junando_dedup_duplicate_total`) inside `ProcessIncidentUseCase`.

  ## Prometheus metrics ingestion adapter (#27, #115, #116)

  New public API in `@junando/ingest`:
  - `IPrometheusHttpClient` port + `PrometheusInstantResponse` /
    `PrometheusInstantResult` types.
  - `PrometheusHttpClient` — fetch-based implementation with bearer auth
    via `tokenEnv`.
  - `MissingEnvError`, `PrometheusHttpError`, `PrometheusParseError`
    typed errors.
  - `PrometheusIngestRunner` — polling loop with in-flight guard and
    `Promise.allSettled` fan-out (mirrors the Loki runner topology).
  - `mapMetricResultToAlerts` — pure mapper with threshold evaluation
    (`>`, `<`, `>=`, `<=`).
  - Config schema: new `kind: 'prometheus'` discriminated union arm with
    per-rule `query`, `service`, `alertType`, `severity`, `threshold`,
    `comparator`, `windowMs?`.

  Threshold model is in-adapter (not in PromQL) to keep rule semantics
  consistent across future metric adapters (e.g. CloudWatch Metrics).
  `AlertType` enum is NOT extended — rules pick `Error`, `Warning`, or
  `Success` semantically based on what the threshold represents.

  ## Notes
  - `alertsProcessed` adding the `result` label resets Prometheus series
    accumulation — acceptable as a new SLI baseline.
  - `latency` histogram switched to SLI buckets for the same reason.
