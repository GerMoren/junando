---
'@junando/ingest': minor
---

feat(ingest): Prometheus metrics ingestion adapter

Adds a Prometheus metrics ingestion adapter that polls PromQL instant queries,
evaluates thresholds in-adapter, and produces `NormalizedAlert[]` consumed by
`ProcessIncidentUseCase` — mirroring the Loki ingestion pattern.

New public API in `@junando/ingest`:

- `IPrometheusHttpClient` port + `PrometheusInstantResponse` / `PrometheusInstantResult` types
- `PrometheusHttpClient` — fetch-based implementation with bearer auth via `tokenEnv`
- `MissingEnvError`, `PrometheusHttpError`, `PrometheusParseError` typed errors
- `PrometheusIngestRunner` — polling loop with in-flight guard and `Promise.allSettled` fan-out
- `mapMetricResultToAlerts` — pure mapper with threshold evaluation (`>`, `<`, `>=`, `<=`)
- Config schema: new `kind: 'prometheus'` discriminated union arm with per-rule
  `query`, `service`, `alertType`, `severity`, `threshold`, `comparator`, `windowMs?`

Threshold model is in-adapter (not in PromQL) to keep rule semantics consistent
across future metric adapters (e.g. CloudWatch Metrics).

`AlertType` enum is NOT extended — rules pick `Error`, `Warning`, or `Success`
semantically based on what the threshold represents.

Closes #27.
