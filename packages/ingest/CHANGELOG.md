# @junando/ingest

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
