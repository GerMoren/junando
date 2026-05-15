# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
