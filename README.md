# Junando

> **Junando is the intelligent correlation layer between your observability stack and incident responders.**

Junando helps teams move from noisy alerts to actionable incident context.
It receives alerts, deduplicates and clusters them, pulls relevant trace/log evidence,
and sends enriched incident summaries to Slack or Teams with correlation IDs.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-green.svg)](https://nodejs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://typescriptlang.org)
[![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io)

---

## Why Junando

Modern observability tools are good at collecting data, but incidents still require humans to manually connect:

- alerts (Alertmanager)
- logs (Loki / CloudWatch)
- traces (Tempo / X-Ray / custom)
- notifications (Slack / Teams)

Junando reduces that cognitive load by producing incident-ready context from existing telemetry.

---

## Quick path (5 minutes)

### 1) Prerequisites

- Node.js `>=24`
- Docker Desktop
- pnpm via Corepack

### 2) Run locally

```bash
git clone https://github.com/GerMoren/junando.git
cd junando
corepack enable
pnpm install

cp .env.example .env.local
pnpm run setup:local

pnpm --filter @junando/core build
pnpm run dev:webhook
```

In another terminal:

```bash
pnpm run generate:alert
```

### 3) Verify

- Webhook health: `http://localhost:4000/health`
- Grafana: `http://localhost:3000`
- Alertmanager: `http://localhost:9093`

---

## What Junando includes

| Package | Purpose |
|---|---|
| `@junando/core` | Domain model + processing pipeline (dedup, clustering, LLM enrichment, notifier abstractions) |
| `@junando/webhook` | HTTP ingestion entrypoint (Alertmanager-compatible webhook) |
| `@junando/worker` | Async processor for incident pipeline execution |
| `@junando/ingest` | Pull-based ingestion runtime (e.g., Loki polling, SQS subscriber) |
| `packages/cdk` | AWS deployment stack (CDK) |

Per-package docs:

- [`packages/core/README.md`](packages/core/README.md)
- [`packages/webhook/README.md`](packages/webhook/README.md)
- [`packages/worker/README.md`](packages/worker/README.md)
- [`packages/ingest/README.md`](packages/ingest/README.md)

---

## Architecture (high level)

```text
Alert sources -> Webhook/Ingest -> Queue -> Worker -> Enrichment (LLM + traces/logs) -> Slack/Teams
                                      \-> Structured logs + metrics -> Grafana/Loki/Prometheus
```

Design principles:

- Hexagonal architecture (ports & adapters)
- Deterministic clustering (not opaque ML alerting)
- Correlation ID propagation end-to-end
- Graceful degradation when dependencies fail

---

## Key capabilities

- Alert deduplication with TTL windows
- Deterministic fingerprint clustering
- Bring-your-own LLM (Gemini / Claude / OpenRouter)
- Structured logging with correlation metadata
- Slack and Teams notifier backends
- AWS-first deployment path + local Docker development flow

---

## Non-goals

- Not an APM
- Not a Grafana replacement
- Not a monitoring backend
- Not autonomous remediation

Junando complements your stack; it does not replace it.

---

## Deployment options

### Local development

Use Docker Compose + local scripts:

```bash
pnpm run setup:local
pnpm run dev:webhook
pnpm run worker:local
```

### AWS (CDK)

```bash
pnpm build
cd packages/cdk
pnpm cdk bootstrap
pnpm cdk deploy --all
```

### Containers

Images are published to GHCR:

- `ghcr.io/germoren/junando-webhook`
- `ghcr.io/germoren/junando-worker`
- `ghcr.io/germoren/junando-ingest`

Tag behavior:

- Merge to `main`: `main`, `sha-*`
- Release tag `v*`: `latest`, semver tags, `sha-*`

---

## Configuration (essential)

Common required variables:

- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LOKI_URL`
- `REDIS_URL`

Notifier-specific:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL`
- Teams: `NOTIFIER_TYPE=teams`, `TEAMS_WEBHOOK_URL`

See `.env.example` for the complete template.

---

## Reliability behavior

Junando is designed to fail gracefully:

- Redis unavailable -> skips dedup (continues processing)
- Loki unavailable -> continues with alert metadata
- LLM unavailable -> sends fallback summary without AI diagnosis
- Notifier failure -> retries and routes to DLQ path

---

## Related documentation

- Ops runbook: [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- Structured logging: [`docs/structured-logging.md`](docs/structured-logging.md)
- Grafana setup: [`docs/runbooks/grafana-setup.md`](docs/runbooks/grafana-setup.md)
- Dashboards: [`docs/dashboards/`](docs/dashboards/)
- Architecture deep dive: [`docs/architecture/system-deep-dive.md`](docs/architecture/system-deep-dive.md)

---

## Contributing

Please read [`AGENT.md`](AGENT.md) before submitting changes.
It contains architecture constraints, coding rules, and workflow conventions.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
