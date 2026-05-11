# PRD: Junando — AI-Powered Incident Intelligence

> **"Junar"** — Lunfardo rioplatense. Significa _observar atentamente, acechar con la vista._

> One command. Any alert stream. Actionable Slack diagnosis in under 90 seconds.

**Version**: 0.1.0-draft
**Author**: German Moreno
**Date**: 2026-05-10
**Status**: Draft

---

## 1. Problem Statement

Modern distributed systems generate massive telemetry but limited insight at alert time. On-call engineers lose critical minutes correlating dashboards, logs, traces, and recent deploys while incidents evolve.

**The real problem isn't alerting — it's noise.** Grafana Alertmanager fires 50 Slack messages for a single database outage. The engineer sees 50 alerts and has to manually group them, find the root cause, and decide what to do.

Junando acts as a virtual Level-3 SRE available 24/7:
- Groups alerts by probable root cause — deterministic, not ML magic
- Extracts 2-3 representative traces per incident, not full log dumps
- Uses an LLM for structured, explainable reasoning
- Delivers results in Slack with real action buttons
- Never acts autonomously — every destructive action requires explicit human approval

**The promise:** reduce hundreds of noisy alerts into a handful of actionable, explainable incident summaries in under 90 seconds.

---

## 2. Vision

**Junando — AI-powered incident intelligence for distributed systems.**

An open-source agent that sits between your existing observability stack and your team's chat tool. It watches alert streams, groups them by probable root cause using deterministic fingerprinting, extracts only the relevant traces, and delivers a structured AI diagnosis to Slack — with action buttons for acknowledgment and rollback.

**Before**: Alertmanager fires 50 Slack messages for one outage → engineer spends 20 minutes grouping, correlating, and investigating.

**After**: One Slack message with cluster summary, probable cause, impacted services, recommended steps, and action buttons. Done in 90 seconds.

---

## 3. Target Users

### Primary

- **On-call engineers** (SREs, DevOps) on teams of 5-50 running AWS + Grafana + Prometheus + Loki
- **Small-to-medium engineering teams** who can't justify $100k/year enterprise AIOps tools

### Secondary

- **Platform engineers** automating incident response for multiple teams
- **Open source maintainers** who want free, self-hosted incident intelligence

---

## 4. Supported Deployments

| Deployment | Method | Target |
|---|---|---|
| AWS (MVP) | CDK + Lambda + SQS | Teams using AWS infrastructure |
| Local Development | Docker Compose | Devs contributing to the project |
| On-Premise / Enterprise | Single Docker container | Teams wanting full control |

**Out of scope:** Managed cloud-hosted version (v2), multi-tenant deployments.

---

## 5. Core Pipeline

Junando processes alerts through a strict linear pipeline (never skip or reorder):

```
Alertmanager → Webhook → Deduplication → Fingerprinting → Context Extraction → LLM Inference → Slack Notification
```

### 5.1 Deduplication

**Component**: Redis TTL window — configurable duration (default: 300s)

**Behavior**: If an alert with the same fingerprint arrives within the TTL window, it is deduplicated (not reprocessed).

**Failure mode**: Redis unreachable → fail open, process all alerts (noisy but safe).

### 5.2 Fingerprinting

**Algorithm**: SHA-256 hash of `serviceName|errorType|endpointPath` (lowercased, trimmed)

**Purpose**: Deterministic cluster key. Two alerts with the same fingerprint = same probable root cause.

**Dedup key prefix**: `junando:dedup:{fingerprint}`

### 5.3 Clustering

**Window**: Configurable (default: 120,000ms)

**Behavior**: Alerts within the window and sharing a fingerprint are grouped into one cluster.

**Representative selection** (max 2 traces per cluster):
1. First alert chronologically (earliest signal)
2. Alert with highest latency (worst-case context)

### 5.4 Context Extraction

**Source**: Loki (LogQL queries by trace_id)

**Behavior**: Fetch 2 representative trace spans per cluster. Fail gracefully if Loki is unreachable (continue with alert metadata only).

### 5.5 LLM Inference

**Providers**: Gemini (default, cheapest), Claude, OpenAI — configurable via `LLM_PROVIDER` env var.

**Output**: Strict JSON validated with Zod schema:
```json
{
  "probable_cause": "string",
  "impacted_services": ["string"],
  "recommended_steps": ["string"],
  "urgency_level": "low | medium | high | critical",
  "requires_rollback": true
}
```

**Token budget**: < 8,000 tokens per call. Max 30 trace spans per cluster.

**Failure mode**: LLM call fails → send cluster summary without AI diagnosis.

### 5.6 Slack Notification

**Format**: Slack Block Kit with action buttons

**Buttons**:
- `[Acknowledge]` — silences re-notification for 30 min
- `[Trigger Rollback]` — requires modal confirmation (no autonomous rollback)
- `[View in Grafana]` — deep link to dashboard

**Failure mode**: Retry 3x with backoff → DLQ alert.

---

## 6. Architecture — Hexagonal + DDD

```
packages/core/src/
├── domain/
│   ├── entities/          Alert, AlertCluster, Incident, LLMAnalysis (Zod schemas)
│   ├── value-objects/     Fingerprint (immutable, SHA-256 hash)
│   ├── ports/             IDeduplicationStore, ITraceRepository, ILLMProvider, INotifier
│   └── services/         ClusteringService (pure, no I/O)
├── application/
│   ├── use-cases/         ProcessIncidentUseCase (orchestrates via ports only)
│   └── dtos/              normalizePayload (Alertmanager → domain entity)
├── infrastructure/        ← concrete adapter implementations
│   ├── dedup/             RedisDeduplicationStore, InMemoryDeduplicationStore
│   ├── traces/            LokiTraceRepository, MockTraceRepository
│   ├── llm/               GeminiProvider, ClaudeProvider, MockLLMProvider
│   └── notifier/          SlackNotifier, ConsoleNotifier
└── shared/
    ├── config/            loadConfig() — fails fast on missing env vars
    └── logger/            createLogger() — Pino structured JSON
```

### Dependency Rules (enforced — never break these)

| Module | Can import | Cannot import |
|---|---|---|
| `domain/` | Nothing external | No AWS, no Redis, no HTTP |
| `application/` | domain ports + entities | No concrete adapters |
| `infrastructure/` | domain ports | AWS SDK here only |
| `webhook/` | @junando/core | Lambda A handler |
| `worker/` | @junando/core | Lambda B handler + wiring |
| `cdk/` | aws-cdk-lib only | All AWS infra |

### Swapping Providers

```
Swap Gemini for Claude    → implement ILLMProvider → change factory in worker
Swap Loki for Datadog     → implement ITraceRepository → change factory in worker
Swap Redis for DynamoDB   → implement IDeduplicationStore → change factory in worker
Swap Slack for Teams     → implement INotifier → change factory in worker
```

No domain or application code changes when swapping infrastructure.

---

## 7. Infrastructure — AWS CDK Stack

**Goal**: Minimum viable infrastructure — Lambda pair + SQS + CloudWatch alarm. No API Gateway, no RDS, no ELB.

### Resources

| Resource | Config |
|---|---|
| SQS Queue | `junando-alerts`, 4-day retention, visibility timeout = Lambda B timeout |
| SQS DLQ | `junando-alerts-dlq`, 14-day retention, redrive after 3 failures |
| Lambda A (webhook) | 256MB, 5s timeout, Node.js 22, Function URL (no API Gateway) |
| Lambda B (worker) | 512MB, 3min timeout, Node.js 22, SQS event source mapping (batch=1) |
| CloudWatch Alarm | DLQ depth > 0 → alert (pipeline failing) |
| SSM Parameters | Read-only via IAM, `/junando/*` path prefix |

### Secrets

Stored in AWS SSM Parameter Store (SecureString):
```
/junando/llm-provider
/junando/llm-api-key
/junando/slack-bot-token
/junando/slack-signing-secret
/junando/slack-channel
/junando/loki-url
/junando/redis-url
```

### AWS Free Tier Considerations

The MVP is designed to fit within AWS free tier limits during evaluation:
- **Lambda**: 400,000 GB-seconds/month free (Lambda A runs ~50ms per alert, Lambda B runs ~10s)
- **SQS**: 1 million free requests/month
- **CloudWatch**: 5GB log ingestion/month free
- **Data transfer**: Minimal — Junando doesn't store telemetry, just processes alerts

**Estimated cost for MVP** (personal evaluation, < 100 alerts/day):
- Near $0 on free tier
- First paid dollar kicks in when you exceed free tier limits significantly

---

## 8. Non-Goals (explicitly out of scope for MVP)

- Not a replacement for Grafana or Prometheus
- Not black-box anomaly detection or ML-based alerting
- Not autonomous remediation (every action requires human approval)
- Not a log storage solution
- Not multi-tenant or enterprise RBAC/SSO
- Not a managed cloud-hosted service

---

## 9. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22+ LTS + TypeScript strict | AWS SDK v3, ecosystem maturity |
| Validation | Zod | Schema-first, full type inference |
| Logging | Pino | Structured JSON, fastest Node.js logger |
| Queue | AWS SQS + DLQ | Managed, pay-per-use, native AWS |
| LLM (MVP) | Gemini 2.0 Flash | Cheapest, 1M token context, swappable via adapter |
| Traces | Loki (LogQL) | Open-source standard |
| Metrics | Prometheus | Open-source standard |
| Alerting | Grafana Alertmanager | Standard webhook integration |
| ChatOps | Slack Block Kit | Action buttons for interactive remediation |
| Secrets | AWS SSM Parameter Store | Free for standard params, least-privilege IAM |
| IaC | AWS CDK TypeScript | Zero YAML, type-safe, generates CloudFormation |
| Tests | Vitest | ESM-native, fast |
| Package manager | pnpm workspaces | Strict deps, no phantom dependencies |
| Build | tsup | esbuild-based, ESM + CJS output |

---

## 10. Requirements — MVP v0.1

### 10.1 Pipeline Requirements

| ID | Requirement | Priority |
|---|---|---|
| R-PIP-01 | Webhook must return 200 in < 50ms (Lambda A validates, enqueues, returns — no pipeline logic) | P0 |
| R-PIP-02 | Fingerprinting must be deterministic SHA-256 — no ML, no randomness | P0 |
| R-PIP-03 | LLM output must be strict JSON validated with Zod schema | P0 |
| R-PIP-04 | Token budget: < 8,000 tokens per LLM call | P0 |
| R-PIP-05 | Max 2 trace IDs per cluster sent to LLM | P0 |
| R-PIP-06 | No autonomous destructive actions — rollback requires human approval via Slack modal | P0 |
| R-PIP-07 | Redis down → fail open, process all alerts | P0 |
| R-PIP-08 | Loki down → continue with alert metadata only | P0 |
| R-PIP-09 | LLM down → send cluster summary without AI diagnosis | P0 |
| R-PIP-10 | Slack delivery fails → retry 3x with backoff → DLQ | P0 |

### 10.2 Architecture Requirements

| ID | Requirement | Priority |
|---|---|---|
| R-ARCH-01 | `domain/` has zero external imports — enforced by architecture, not linter | P0 |
| R-ARCH-02 | No `any` in TypeScript — use `unknown` + Zod parse at every external boundary | P0 |
| R-ARCH-03 | No `switch-case` — use `Map` registries for factory functions | P0 |
| R-ARCH-04 | No hardcoded values — constants go in `packages/core/src/shared/constants.ts` | P0 |
| R-ARCH-05 | Swapping a provider = implementing the port interface + changing the factory | P0 |

### 10.3 Infrastructure Requirements

| ID | Requirement | Priority |
|---|---|---|
| R-INF-01 | Lambda A uses Function URL (no API Gateway) | P0 |
| R-INF-02 | SQS DLQ with 14-day retention and redrive policy | P0 |
| R-INF-03 | CloudWatch alarm fires when DLQ depth > 0 | P0 |
| R-INF-04 | Secrets stored in SSM Parameter Store (SecureString) | P0 |
| R-INF-05 | CDK synth outputs `WebhookURL` for Alertmanager configuration | P0 |

### 10.4 Testing Requirements

| ID | Requirement | Priority |
|---|---|---|
| R-TEST-01 | Unit tests for all domain logic (fingerprint, clustering, normalizePayload) | P0 |
| R-TEST-02 | Unit tests for use-cases using mock ports | P0 |
| R-TEST-03 | Integration test for webhook handler (local mode) | P1 |
| R-TEST-04 | E2E test: synthetic alert → webhook → pipeline → ConsoleNotifier | P1 |
| R-TEST-05 | Minimum coverage: 80% lines, 80% functions | P0 |

### 10.5 Observability Requirements (Dogfooding)

| ID | Requirement | Priority |
|---|---|---|
| R-OBS-01 | `/health` endpoint returns Lambda status | P0 |
| R-OBS-02 | Prometheus metrics endpoint at `/metrics` (Junando monitoring itself) | P1 |
| R-OBS-03 | All log entries include `correlationId` | P0 |
| R-OBS-04 | `LOG_LEVEL` configurable via env var | P0 |

---

## 11. Local Development Setup

Docker Compose stack:
- **Redis**: deduplication store
- **Loki**: trace storage (single-binary)
- **Prometheus**: metrics collection
- **Grafana + Alertmanager**: alert generation
- **Junando Webhook**: local dev server on `:4000`

```
pnpm run setup:local     # start Docker stack
pnpm run dev:webhook     # start webhook on :4000 (watch mode)
pnpm run generate:alert  # fire synthetic alert
```

---

## 12. Definition of Done — MVP v0.1

An alert flow is considered complete when:

- [ ] Alertmanager fires a webhook to `http://localhost:4000/webhook/alert`
- [ ] Lambda A validates payload with Zod, enqueues to SQS (or runs inline in local mode), returns 200 in < 50ms
- [ ] Lambda B processes the alert: dedup → fingerprint → cluster → extract traces → LLM inference → Slack notification
- [ ] Slack receives a Block Kit message with cluster summary, probable cause, recommended steps, and action buttons
- [ ] Clicking `[Acknowledge]` silences re-notification for 30 minutes
- [ ] Clicking `[Trigger Rollback]` requires modal confirmation before any action
- [ ] Redis failure: pipeline continues, no alerts dropped
- [ ] Loki failure: cluster sent to LLM with metadata only, no traces
- [ ] LLM failure: Slack message sent with cluster summary, no diagnosis
- [ ] All unit tests pass: `pnpm test`
- [ ] All packages build without errors: `pnpm build`
- [ ] CDK synth produces valid CloudFormation with `WebhookURL` output
- [ ] First deployment succeeds on personal AWS account (manual deploy, no CI yet)
- [ ] Manual end-to-end test with real alert flow completes successfully

---

## 13. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Webhook latency (P50) | < 30ms | CloudWatch Lambda insights |
| Webhook latency (P99) | < 50ms | CloudWatch Lambda insights |
| End-to-end alert processing time | < 90 seconds | Slack message timestamp minus Alertmanager fire time |
| LLM token cost per incident | < 8,000 tokens | LLM provider logs |
| Zero false positives (dedup accuracy) | > 95% | Manual review of duplicate clusters |
| Deployment time (CDK) | < 5 minutes | Time from `cdk deploy` to Lambda live |
| Local dev setup time | < 10 minutes | Fresh clone to first synthetic alert |

---

## 14. Roadmap

### v0.1 (MVP — Current)

**Goal**: First working deployment. Alert flows through the full pipeline to Slack.

- [x] Architecture design & documentation
- [x] Monorepo scaffold (pnpm + tsconfig + tooling)
- [x] DDD + Hexagonal architecture
- [x] `core` package: types, fingerprinting, dedup, LLM adapters, Slack
- [x] `webhook` package: Lambda A handler (local + AWS mode)
- [x] `worker` package: Lambda B + pipeline
- [x] `cdk` package: full AWS stack
- [x] Docker Compose local dev stack
- [ ] Unit tests (domain + use-cases)
- [ ] End-to-end test with real Gemini API key
- [ ] First real deployment on personal AWS account
- [ ] Manual end-to-end validation

### v0.2 (Post-MVP)

- [ ] GitHub Actions CI pipeline
- [ ] Automated deployment (not manual CDK deploy)
- [ ] Slack interactivity: acknowledge, rollback modal, Grafana deep links
- [ ] Prometheus metrics endpoint + Grafana dashboard for Junando itself
- [ ] `generate-alert.ts` configurable via env var for realistic testing

### v1.0 (Production-ready)

- [ ] First external pilot customer
- [ ] Documentation site (docs.junando.dev)
- [ ] Versioned releases with changelog
- [ ] Contribution guidelines + AGENT.md enforcement

---

## 15. Competitive Positioning

| Competitor | Price | Open Source | Self-Hosted | Bring Your Own LLM |
|---|---|---|---|---|
| Dynatrace AIOps | $100k+/year | ❌ | ❌ | ❌ |
| Datadog AIOps | $100k+/year | ❌ | ❌ | ❌ |
| Moogsoft | Enterprise | ❌ | ❌ | ❌ |
| BigPanda | Enterprise | ❌ | ❌ | ❌ |
| **Junando** | **Free / $199-499/mo** | **✅** | **✅** | **✅** |

**Differentiation**: Open-source core, bring-your-own stack, bring-your-own LLM, installs in under 60 minutes, near-zero cost on AWS free tier during evaluation.
