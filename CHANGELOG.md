# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Observability — Grafana SLI dashboard pack** (issue #78): new `Junando SLIs` dashboard (`docs/dashboards/junando-slis.json`) auto-provisioned by the compose Grafana stack. Four panels: ingest latency p95, dedup ratio, incident throughput, notification outcomes. Cloud import instructions in `docs/dashboards/README.md`.
- **Metrics — webhook latency instrumentation** (issue #101): `junando_webhook_duration_seconds` histogram with SLI buckets and a `status` label, observed synchronously inside the webhook critical path (preserves <50ms budget).
- **Metrics — alerts processed counter** (issue #102): `junando_alerts_processed_total{result}` incremented per processed SQS batch in the worker handler.
- **Metrics — notification outcomes** (issue #103): `junando_notifications_total{channel, outcome}` emitted by the Slack and Teams adapters on every send attempt (`success` / `failure`).
- **Metrics — SQS queue lag** (issue #104): new `startSqsLagPoller()` exported from `@junando/core` and wired into the worker. Emits `junando_sqs_queue_lag{queue_name}` via `setInterval` (warm-container only on AWS Lambda).
- **Metrics — dedup counter pair**: `junando_dedup_new_total` and `junando_dedup_duplicate_total` incremented inside `ProcessIncidentUseCase`, enabling the dedup ratio panel.
- **Ingest — Prometheus metrics adapter** (issue #27): new public API in `@junando/ingest`:
  - `IPrometheusHttpClient` port + `PrometheusInstantResponse` / `PrometheusInstantResult` types.
  - `PrometheusHttpClient` — fetch-based implementation with bearer auth via `tokenEnv`.
  - `MissingEnvError`, `PrometheusHttpError`, `PrometheusParseError` typed errors.
  - `PrometheusIngestRunner` — polling loop with in-flight guard and `Promise.allSettled` fan-out (mirrors the Loki runner topology).
  - `mapMetricResultToAlerts` — pure mapper with in-adapter threshold evaluation (`>`, `<`, `>=`, `<=`).
  - Config schema: new `kind: 'prometheus'` discriminated union arm with per-rule `query`, `service`, `alertType`, `severity`, `threshold`, `comparator`, `windowMs?`.

### Changed

- **Metrics — `alertsProcessed` label set**: added `result` label. Resets Prometheus series accumulation (acceptable as a new SLI baseline; previous emission was always 0).
- **Metrics — `latency` histogram**: switched to SLI buckets and added `status` label. Same series reset note applies.

### Internal

- `packages/worker/src/__tests__/handler.test.ts` now uses `AlertType.Error` instead of the raw string `'http_500'` (3 sites). No behavior change.

## [0.7.4] — 2026-05-24

### Added

- **Notifier**: Microsoft Teams adapter via Power Automate Workflow webhooks (issue #21). `TeamsNotifier` sends Adaptive Card v1.5 payloads with full LLM analysis (service, urgency, probable cause, recommended steps, runbook action) or a minimal fallback card when analysis is unavailable. Config uses `NOTIFIER_TYPE=teams` + `TEAMS_WEBHOOK_URL`. Existing Slack deployments are unaffected — `NOTIFIER_TYPE` defaults to `slack`.
- **Config**: `NOTIFIER_TYPE` discriminated union with `superRefine` validation. Slack fields required only when `NOTIFIER_TYPE=slack`; Teams URL (with `api-version=` query param) required only when `NOTIFIER_TYPE=teams`. Cross-pollution prevented — no false failures on shared environments.
- **Core**: `createNotifier(config)` factory in `packages/core/src/infrastructure/notifier/factory.ts` — single instantiation point for all notifier types (WIR-02).

- **CI**: Docker workflow now triggers on merge to `main` in addition to `v*` tags (issue #26). Merges to `main` publish `:main` + `:sha-<short>` tags. The `:latest` tag is only moved on semver releases, keeping it as a stable pointer.
- **CI**: Added `type=semver,pattern={{major}}.{{minor}}` tag (e.g. `0.2`) to all three images on release.

 `@junando/ingest` v1 — Loki log polling adapter (issue #23). Hexagonal package (`packages/ingest/`) with `IngestRunner`, `LokiHttpClient`, `mapLokiResultToAlerts`, and `loadIngestConfig`. Polls Loki via LogQL on a configurable interval and forwards matches to `ProcessIncidentUseCase`. No Alertmanager required.
- **Ingest**: `scripts/ingest-server.ts` — composition root for `junando-ingest` Docker service. Handles SIGTERM/SIGINT with drain of in-flight rule promises.
- **Ingest**: `docker/Dockerfile.ingest` — multi-stage image (builder + alpine runner, non-root user). Published to `ghcr.io/germoren/junando-ingest` on every semver tag.
- **Ingest**: `docker/docker-compose.prod.yml` — added `junando-ingest` service with config volume mount.
- **Ingest**: `docker/ingest.config.example.yaml` — annotated template with 3 Loki rule examples for Grafana Cloud.
- **Ingest**: `docker/ingest.config.local.yaml` — ready-to-use config for the local Docker stack (`http://localhost:3100`).
- **CI**: `build-ingest` job in `.github/workflows/docker.yml` — builds and pushes `junando-ingest` multi-arch image (amd64 + arm64) on semver tags.
- **Scripts**: `scripts/ingest-local.ts` — single-tick ingest smoke test against local Loki. Uses `MockLLMProvider` by default (no LLM credits). Flags: `--config <path>`, `--real-llm`. Run via `pnpm ingest:local`.
- **Scripts**: `scripts/factories/process-incident.factory.ts` — shared factory for `ProcessIncidentUseCase`, reused by `ingest-server.ts`, `worker-local.ts`, and `worker-server.ts`.
- **Docs**: `docs/structured-logging.md` — structured logging guide with required/recommended field tables, PII redaction rules, and LogQL query examples (LOG-01–LOG-04).
- **Docker**: Added `name: junando` to all compose files — containers now named `junando-webhook-1`, `junando-redis-1`, etc. instead of `docker-*`.

### Fixed

- **Ingest**: `packages/ingest/tsconfig.build.json` — removed `rootDir: src` constraint that caused DTS build failure when tsc traversed cross-workspace `@junando/core` dependency.
- **Ingest**: `docker/Dockerfile.ingest` — `tsup` now runs from `WORKDIR /app` (not `cd scripts/`) since entry paths are resolved relative to CWD. `COPY` path fixed to `dist/ingest-server.mjs`.
- **Ingest**: `docker/ingest.config.example.yaml` — `alertType` values corrected to match schema enum (`http_500`, `latency_spike`, `recovery`). Previous values (`AVAILABILITY`, `PERFORMANCE`) were invalid.

### Observability
- **Observability**: `docs/runbooks/grafana-setup.md` — step-by-step guide for connecting Grafana Cloud to Loki and CloudWatch, IAM inline policy (`cloudwatch:GetMetricData`), cross-account role setup, dashboard import, and template variable binding.
- **Metrics**: `junando_llm_inference_duration_seconds` histogram now includes `model` label — recorded on every successful OpenRouter call with elapsed duration in seconds.
- **Metrics**: `junando_llm_inference_total` counter now incremented in `OpenRouterProvider.analyze()` with `status=success`, `status=error`, or `status=rate_limited` on each completed attempt.
- **Metrics**: `junando_alert_clusters` gauge now set after each clustering run in `ProcessIncidentUseCase` via the new optional `onClustersBuilt` callback, wired at the composition root in the worker Lambda.

- **LLM**: Automatic fallback chain for OpenRouter providers — after primary model exhausts 429 retries, cycles through `LLM_FALLBACK_MODELS` (comma-separated) in order until one succeeds or the wall-clock timeout (`LLM_FALLBACK_TIMEOUT_MS`, default 60s) is exceeded.
- **LLM**: `llm:fallback:hop` structured log event emitted on each model transition with `{ from_model, to_model, reason }`.
- **Config**: New fields `llmFallbackModels` (string[]) and `llmFallbackTimeoutMs` (number) wired to env vars and SSM (`/junando/llm-fallback-models`, `/junando/llm-fallback-timeout-ms`).
- **Constants**: `LLM_FALLBACK_DEFAULTS` constant (`{ TimeoutMs: 60_000, Models: [] }`).
- **Deploy**: SSM parameters `/junando/llm-fallback-models` and `/junando/llm-fallback-timeout-ms` documented in `DEPLOY.md`.

- **Logger**: Structured JSON logging via Pino with `correlationId` propagation across webhook → SQS → worker → LLM → notifier.
- **Logger**: Custom in-process Loki transport (`loki-transport.ts`) with bounded ring buffer (1000 entries) and synchronous `flushLoki()` for Lambda-safe delivery to Grafana Cloud.
- **LLM**: `OpenRouterProvider.analyze` retries once on HTTP 429 with backoff (`retry_after_seconds` from response, else 5s, capped at 30s).
- **LLM**: Verbose structured logs per call — model name, prompt/completion/total tokens, latency in ms.
- **Queue**: Extracted `SqsAlertQueueAdapter` from the webhook handler for cleaner separation between HTTP entry point and queue infrastructure.
- **Config**: Loads secrets from SSM Parameter Store at startup when `SSM_PREFIX` is set (Lambda deploy path).
- **CI**: Added `cdk synth` step to PR validation for safe infrastructure checks.
- **Bundling**: Configured `tsup` to bundle all internal monorepo dependencies (`noExternal: [/./]`) for self-contained Lambda deployments.
- **Scripts**: Added `JUNANDO_WEBHOOK_URL` support to `generate-alert.ts` for production testing.

### Changed

- **Logger**: Replaced `pino-loki` with the in-process buffered transport — `pino-abstract-transport` runs in a `worker_thread` that Lambda kills before the 5s flush completes, dropping logs.
- **Config**: `lokiUrl` validation switched from `z.string().url()` to a plain `z.string().min(1)` so embedded credentials (`https://USER:TOKEN@host/...`) are accepted.
- **CI**: Bumped GitHub Actions to Node 24-native majors (`actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, `pnpm/action-setup@v6`); removed the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` workaround.

### Fixed

- **Logger**: Loki timestamp `NaN` bug — transport now handles both ISO strings and epoch ms from Pino.
- **Logger**: Module-level loggers now pick up Loki after `reinitLogger` via a Proxy pattern, fixing Lambda cold-start wiring.
- **Logger**: Logger Proxy is read-only — removed `set` trap that would silently mutate the global root logger and leak across instances.
- **Webhook/Worker**: Wrapped handler bodies in `try/finally` so `flushLoki()` runs on both success and error paths (incident logs were lost on thrown errors).
- **LLM**: 429 responses without `retry_after_seconds` are now retried (some providers like Google AI Studio via OpenRouter omit the field); removed `response_format: json_object` since the Qwen free tier rejects it.
- **CI**: Updated Node version to 24 to match `.nvmrc`.
- **CI**: Fixed build order to run `pnpm build` before `pnpm typecheck` to resolve monorepo dependencies.
- **Webhook**: Added missing `await` to `loadConfig` calls, fixing critical runtime type errors.
- **Worker**: Fixed SQS message validation by synchronizing `NormalizedAlert` schema and adding `fingerprint` mapping.
- **CDK**: Resolved security warnings by enabling KMS encryption for SQS queues.
- **Scripts**: Refactored `generate-alert.ts` to use top-level await, addressing SonarCloud warnings.
- **IAM**: Expanded Worker Lambda permissions to include `ssm:GetParameter*` and `kms:Decrypt` for secure secret retrieval.

### Removed

- **Deps**: Dropped `pino-loki` — replaced by the in-process Loki buffer transport.
