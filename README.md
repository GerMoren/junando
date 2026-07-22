# Junando

> **Stop triaging alerts manually. Junando correlates your observability stack and delivers actionable incident context directly to Slack or Teams.**

Your monitoring fires 40 alerts at 3am. Each one is a raw signal — no context, no cause, no next step. Someone wakes up, opens Prometheus, opens Loki, opens the deployment history, and spends 20 minutes piecing together what happened before they can even start fixing it.

Junando eliminates that gap.

[![npm](https://img.shields.io/npm/v/@junando/core)](https://www.npmjs.com/package/@junando/core)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-green.svg)](https://nodejs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://typescriptlang.org)
[![Docs](https://img.shields.io/badge/Docs-junando--docs--rouge.vercel.app-3b82f6)](https://junando-docs-rouge.vercel.app/)

---

## What it looks like in practice

Instead of raw alerts flooding your channel, your team gets this in Slack or Teams:

```
🟡 Incident — checkout-api

Service     checkout-api        Alerts   1
Endpoint    /api/orders         Urgency  🟡 HIGH

Probable cause
Internal server error due to unhandled exception or upstream service failure

Recommended steps
1. Check application logs for stack traces and error messages
2. Review recent deployments for potential issues
3. Verify the health and availability of upstream services

[ ✅ Acknowledge ]  [ 🔀 Trigger Rollback ]
```

One message. Correlated. With context. Actionable.

---

## How it works

```
Alert sources → Webhook / Ingest → Queue → Worker → Enrichment → Slack / Teams
                                                         │
                                              LLM analysis + log correlation
```

1. **Ingest** — Alerts arrive via webhook (Alertmanager-compatible) or pull-based ingest (Loki, Prometheus metrics)
2. **Deduplicate** — Fingerprint-based clustering groups related alerts into a single incident
3. **Enrich** — LLM analysis generates probable cause and recommended steps from correlated log/metric context
4. **Notify** — One structured message goes to Slack or Teams with interactive buttons (Acknowledge, Trigger Rollback)

Junando is **source-agnostic**: the same pipeline handles alerts from Alertmanager, Loki queries, PromQL polling, or any custom webhook. It **does not replace** your monitoring stack — it sits on top of it and translates signals into context.

---

## Quick start

```bash
pnpm create junando-app my-app
cd my-app/app
pnpm dev
```

The scaffold creates `.env` from `.env.example` with placeholder values. Edit it with your LLM and Slack keys.

For a full walkthrough: [`examples/express-end-to-end/README.md`](examples/express-end-to-end/README.md)

---

## Packages

| Package | Purpose |
|---|---|
| [`@junando/core`](packages/core/README.md) | Domain model, dedup, clustering, LLM enrichment, notifier abstractions |
| [`@junando/webhook`](packages/webhook/README.md) | HTTP ingestion entrypoint (Alertmanager-compatible) |
| [`@junando/worker`](packages/worker/README.md) | Async processor for the incident pipeline |
| [`@junando/ingest`](packages/ingest/README.md) | Pull-based ingest runtime (Loki polling, Prometheus PromQL) |
| [`packages/cdk`](packages/cdk) | AWS deployment stack (CDK) |

---

## Key design decisions

**Bring your own LLM** — Gemini, Claude, OpenRouter, or anything with a compatible API. No vendor lock-in.

**Hexagonal architecture** — Alert sources (Loki, Prometheus, webhook, SQS) and notification targets (Slack, Teams) are ports. You can swap or add adapters without touching the core pipeline.

**Deterministic clustering** — Alerts group by fingerprint, not opaque ML scoring. You can reason about and test the grouping behavior.

**Graceful degradation** — Redis unavailable → skips dedup (continues). Loki unavailable → continues with alert metadata. LLM unavailable → sends fallback summary without AI diagnosis. Notifier failure → retries and routes to DLQ.

**Interactive actions** — The Trigger Rollback button in Slack/Teams reaches a configurable `RollbackActionHandler` port. Wire it to your deployment pipeline (GitHub Actions dispatch, ArgoCD, CodeDeploy) or leave the default no-op and act on the structured log it emits. See [#125](https://github.com/GerMoren/junando/issues/125).

---

## Run locally (5 minutes)

```bash
git clone https://github.com/GerMoren/junando.git
cd junando
corepack enable
pnpm install

cp .env.example .env.local
pnpm run setup:local   # starts Docker stack (Redis, Loki, Grafana, Alertmanager)

pnpm --filter @junando/core build
pnpm run dev:webhook
```

In another terminal:

```bash
pnpm run generate:alert   # fires a test alert through the full pipeline
```

Or run everything in one shot:

```bash
pnpm run quickstart
```

**Verify:**
- Webhook: `http://localhost:4000/health`
- Grafana: `http://localhost:3000`
- Alertmanager: `http://localhost:9093`

---

## Deploy to AWS

```bash
pnpm build
cd packages/cdk
pnpm cdk bootstrap
pnpm cdk deploy --all
```

Container images are published to GHCR:

- `ghcr.io/germoren/junando-webhook`
- `ghcr.io/germoren/junando-worker`
- `ghcr.io/germoren/junando-ingest`

---

## Configuration

Required environment variables:

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `gemini`, `claude`, or `openrouter` |
| `LLM_API_KEY` | API key for the chosen LLM provider |
| `LOKI_URL` | Loki endpoint for log correlation |
| `REDIS_URL` | Redis for dedup TTL windows |
| `SLACK_BOT_TOKEN` | Slack bot token (if using Slack notifier) |
| `SLACK_CHANNEL` | Target Slack channel |
| `TEAMS_WEBHOOK_URL` | Teams webhook URL (if using Teams notifier) |

See [`.env.example`](.env.example) for the full template.

---

## What Junando is not

- Not an APM or tracing backend
- Not a Grafana replacement
- Not a monitoring collector
- Not autonomous remediation

It complements your existing stack. It does not replace it.

---

## Status

Active development. Currently used in staging environments. The core pipeline (ingest → dedup → enrich → notify) is stable. The business rules engine (filter, route, escalate by policy) is on the roadmap at [#29](https://github.com/GerMoren/junando/issues/29).

Feedback welcome — open an issue or start a discussion.

---

## Documentation

- [Architecture deep dive](docs/architecture/system-deep-dive.md)
- [NestJS integration](docs/integrations/nestjs.md)
- [Wide events — canonical log lines](docs/WIDE-EVENTS.md)
- [Ops runbook](docs/RUNBOOK.md)
- [Grafana setup](docs/runbooks/grafana-setup.md)
- [Compatibility matrix](docs/compatibility.md)
- [API stability policy](docs/api-stability.md)
- [Contributing](AGENT.md)

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
