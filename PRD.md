# PRD: Junando — AI-Powered Incident Intelligence

> **"Junar"** — Lunfardo rioplatense. Significa _observar atentamente, acechar con la vista._

> One command. Any alert stream. Actionable Slack diagnosis in under 90 seconds.

**Version**: 0.18.0
**Author**: German Moreno
**Date**: 2026-09-20
**Status**: Active development — piloted on a personal AWS account, awaiting an external pilot team (see [issue #155](https://github.com/GerMoren/junando/issues/155))

---

## 1. Problem Statement

Modern distributed systems generate massive telemetry but limited insight at alert time. On-call engineers lose critical minutes correlating dashboards, logs, traces, and recent deploys while incidents evolve.

**The real problem isn't alerting — it's noise.** Grafana Alertmanager fires 50 Slack messages for a single database outage. The engineer sees 50 alerts and has to manually group them, find the root cause, and decide what to do.

Junando acts as a virtual Level-3 SRE available 24/7:
- Groups alerts by probable root cause — deterministic, not ML magic
- Extracts representative traces per incident, not full log dumps
- Uses an LLM for structured, explainable reasoning
- Optionally runs a cheap severity classifier first, to skip the expensive LLM call on low-signal noise
- Delivers results in Slack or Teams with real action buttons
- Never acts autonomously — every destructive action requires explicit human approval

**The promise:** reduce hundreds of noisy alerts into a handful of actionable, explainable incident summaries in under 90 seconds.

---

## 2. Vision

**Junando — AI-powered incident intelligence for distributed systems.**

An open-source agent that sits between your existing observability stack and your team's chat tool. It watches alert streams, groups them by probable root cause using deterministic fingerprinting, extracts only the relevant traces, and delivers a structured AI diagnosis to Slack or Teams — with action buttons for acknowledgment and rollback.

**Before**: Alertmanager fires 50 Slack messages for one outage → engineer spends 20 minutes grouping, correlating, and investigating.

**After**: One Slack (or Teams) message with cluster summary, probable cause, impacted services, recommended steps, and action buttons. Done in 90 seconds.

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
| AWS | CDK + Lambda + SQS + DynamoDB | Teams using AWS infrastructure |
| Local Development | Docker Compose | Devs contributing to the project |
| On-Premise / Enterprise | Helm chart (Kubernetes) | Teams wanting full control |

**Out of scope:** Managed cloud-hosted version (v2), multi-tenant deployments.

---

## 5. Core Pipeline

Junando processes alerts through a strict linear pipeline (never skip or reorder), with one optional branch point:

```
Alertmanager → Webhook → Deduplication → Fingerprinting → Context Extraction → [optional Triage] → LLM Inference → Notification (Slack/Teams)
```

### 5.1 Deduplication

**Component**: DynamoDB fingerprint+TTL table (default, AWS free-tier friendly) or Redis TTL window (self-hosted / Docker Compose target) — configurable duration (default: 300s).

**Behavior**: If an alert with the same fingerprint arrives within the TTL window, it is deduplicated (not reprocessed).

**Failure mode**: Store unreachable → fail open, process all alerts (noisy but safe).

### 5.2 Fingerprinting

**Algorithm**: SHA-256 hash of `serviceName|alertType|endpointPath` (lowercased, trimmed)

**Purpose**: Deterministic cluster key. Two alerts with the same fingerprint = same probable root cause.

### 5.3 Clustering

**Window**: Configurable (default: 120,000ms)

**Behavior**: Alerts within the window and sharing a fingerprint are grouped into one cluster.

**Representative selection** (max 2 traces per cluster):
1. First alert chronologically (earliest signal)
2. Alert with highest latency (worst-case context)

### 5.4 Context Extraction

**Source**: Loki (LogQL queries by trace_id)

**Behavior**: Fetch representative trace spans per cluster. Fail gracefully if Loki is unreachable (continue with alert metadata only).

### 5.5 Triage (optional, off by default)

**Purpose**: A cheap classification step ahead of the full LLM analysis, so low-severity noise never reaches the expensive call.

**Providers**:
- `jev` — TypeSafe AI's Jev, via Vercel AI Gateway's Evaluation API (`POST /v1/evaluate`), a purpose-built decision/scoring model. Fast (~150-400ms), no `TRIAGE_MODEL` needed.
- `vercel-gateway` — any chat-completions-capable model in the Gateway's catalog, asked for a single severity word. Requires a plain instruction-following `TRIAGE_MODEL` — reasoning/"thinking" models burn their token budget on an internal preamble and never emit the word.

**Behavior**: `low` severity skips the full LLM call and notifies via the standard no-diagnosis fallback message. `medium`/`high`/`critical` proceed to full analysis.

**Failure mode**: Fail open — any triage error/ambiguity proceeds to the full LLM analysis exactly as if triage were disabled. A triage hiccup never suppresses a real incident.

### 5.6 LLM Inference

**Providers**: Gemini, Claude, OpenRouter, Qwen, Amazon Bedrock, or Vercel AI Gateway (any model in its catalog) — configurable via `LLM_PROVIDER`. Only Bedrock keeps data and inference inside the AWS account boundary; every other provider is a third-party API call.

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

**Failure mode**: LLM call fails → send cluster summary without AI diagnosis (same fallback path triage uses).

### 5.7 Notification

**Targets**: Slack (Block Kit) or Microsoft Teams (Adaptive Cards) — one or the other, never both at once.

**Slack buttons**:
- `[Acknowledge]` — available on both the full-analysis and no-diagnosis fallback message
- `[Trigger Rollback]` — only on the full-analysis message (needs the LLM's `requires_rollback` verdict); requires a Slack confirm dialog, no autonomous action

**Failure mode**: Retry with backoff → DLQ.

---

## 6. Architecture — Hexagonal + DDD

```
packages/core/src/
├── domain/
│   ├── entities/          Alert, AlertCluster, Incident, LLMAnalysis (Zod schemas)
│   ├── value-objects/     Fingerprint (immutable, SHA-256 hash)
│   ├── ports/             IDeduplicationStore, ITraceRepository, ILLMProvider, ITriageProvider, INotifier, IRuleEngine, IRollbackActionHandler
│   └── services/         ClusteringService (pure, no I/O)
├── application/
│   ├── use-cases/         ProcessIncidentUseCase (orchestrates via ports only)
│   └── dtos/              normalizePayload (Alertmanager → domain entity)
├── infrastructure/        ← concrete adapter implementations
│   ├── dedup/             DynamoDBDeduplicationStore, RedisDeduplicationStore, InMemoryDeduplicationStore
│   ├── traces/            LokiTraceRepository, MockTraceRepository
│   ├── llm/               GeminiProvider, ClaudeProvider, OpenRouterProvider (also serves Qwen), BedrockProvider, VercelGatewayProvider, MockLLMProvider
│   ├── triage/             JevTriageProvider, VercelGatewayTriageProvider
│   ├── notifier/           SlackNotifier, TeamsNotifier, ConsoleNotifier
│   └── rollback/           NoopRollbackActionHandler (real handlers are per-deployment)
└── shared/
    ├── config/            loadConfig() — fails fast on missing env vars
    └── logger/            createLogger() — Pino structured JSON, wide events + redaction
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
Swap Gemini for Claude        → implement ILLMProvider → change factory in worker
Swap Loki for Datadog         → implement ITraceRepository → change factory in worker
Swap DynamoDB for Redis dedup → implement IDeduplicationStore → change factory in worker
Swap Slack for Teams          → implement INotifier → change factory in worker
```

No domain or application code changes when swapping infrastructure.

---

## 7. Infrastructure — AWS CDK Stack

**Goal**: Minimum viable infrastructure — Lambda pair + SQS + DynamoDB + CloudWatch alarm. No API Gateway, no RDS, no ELB.

### Resources

| Resource | Config |
|---|---|
| SQS Queue | FIFO, 4-day retention, visibility timeout = Lambda B timeout |
| SQS DLQ | FIFO, 14-day retention, redrive after 3 failures |
| DynamoDB Table | Fingerprint+TTL dedup store, on-demand billing (AWS default) |
| Lambda A (webhook) | Node.js 24.x, Function URL (no API Gateway) |
| Lambda B (worker) | Node.js 24.x, SQS event source mapping (batch=1); Function URL for `/metrics`, IAM-SigV4-restricted to a monitoring account |
| CloudWatch Alarm | DLQ depth > 0 → alert (pipeline failing) |
| SSM Parameters | Read-only via IAM, `/junando/*` path prefix (or `/junando-pilot/*` for pilot deploys) |

### Secrets

Stored in AWS SSM Parameter Store (SecureString), auto-discovered under the deployment's `SSM_PREFIX`:
```
/junando/llm-provider
/junando/llm-api-key            (not needed for bedrock — IAM-authenticated)
/junando/llm-model               (required for vercel-gateway)
/junando/slack-bot-token
/junando/slack-signing-secret
/junando/slack-channel
/junando/loki-url
/junando/redis-url                (only if DEDUP_STORE=redis)
/junando/llm-fallback-models
/junando/llm-fallback-timeout-ms
/junando/rollback-action-enabled
/junando/rollback-action-allowed-slack-user-ids
/junando/triage-enabled           (optional feature, off by default)
/junando/triage-provider
/junando/triage-model             (not needed for triage-provider=jev)
/junando/triage-api-key
```

### AWS Free Tier / Pilot Cost

Real, measured cost for a low-volume pilot deployment on Bedrock Nova Lite: **~$2-4/month**. See [DEPLOY.md](DEPLOY.md) for the full readiness checklist and cost breakdown.

---

## 8. Non-Goals (explicitly out of scope)

- Not a replacement for Grafana or Prometheus
- Not black-box anomaly detection or ML-based alerting
- Not autonomous remediation (every destructive action requires human approval)
- Not a log storage solution
- Not multi-tenant or enterprise RBAC/SSO
- Not a managed cloud-hosted service

---

## 9. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 24+ LTS + TypeScript strict | AWS SDK v3, ecosystem maturity |
| Validation | Zod | Schema-first, full type inference |
| Logging | Pino | Structured JSON, wide events, fastest Node.js logger |
| Queue | AWS SQS FIFO + DLQ | Managed, pay-per-use, native AWS |
| Dedup store | DynamoDB (AWS default) or Redis (self-hosted default) | Swappable via `IDeduplicationStore` |
| LLM | Gemini, Claude, OpenRouter, Qwen, Bedrock, or Vercel AI Gateway | Swappable via `ILLMProvider`; Bedrock is the privacy-first default (data never leaves the AWS account) |
| Traces | Loki (LogQL) | Open-source standard |
| Metrics | Prometheus | Open-source standard |
| Alerting | Grafana Alertmanager | Standard webhook integration |
| ChatOps | Slack Block Kit or Teams Adaptive Cards | Action buttons for interactive remediation |
| Secrets | AWS SSM Parameter Store | Free for standard params, least-privilege IAM |
| IaC | AWS CDK TypeScript | Zero YAML, type-safe, generates CloudFormation |
| Self-hosted IaC | Helm chart | Kubernetes deployments outside AWS |
| Tests | Vitest | ESM-native, fast |
| Package manager | pnpm workspaces | Strict deps, no phantom dependencies |
| Build | tsdown / rolldown | esbuild-based, ESM + CJS output |
| CI/CD | GitHub Actions | Lint/test/typecheck, integration tests, Docker image builds, Helm lint, changesets release |

---

## 10. Requirements

### 10.1 Pipeline Requirements

| ID | Requirement | Priority |
|---|---|---|
| R-PIP-01 | Webhook returns quickly — Lambda A validates, enqueues, returns; no pipeline logic runs inline | P0 |
| R-PIP-02 | Fingerprinting must be deterministic SHA-256 — no ML, no randomness | P0 |
| R-PIP-03 | LLM output must be strict JSON validated with Zod schema | P0 |
| R-PIP-04 | No autonomous destructive actions — rollback requires human approval via Slack confirm dialog | P0 |
| R-PIP-05 | Dedup store down → fail open, process all alerts | P0 |
| R-PIP-06 | Loki down → continue with alert metadata only | P0 |
| R-PIP-07 | LLM down → send cluster summary without AI diagnosis | P0 |
| R-PIP-08 | Notification delivery fails → retry with backoff → DLQ | P0 |
| R-PIP-09 | Triage (when enabled) fails open — any error/ambiguity proceeds to the full LLM analysis | P0 |

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
| R-INF-02 | SQS DLQ with retention and redrive policy | P0 |
| R-INF-03 | CloudWatch alarm fires when DLQ depth > 0 | P0 |
| R-INF-04 | Secrets stored in SSM Parameter Store (SecureString) | P0 |
| R-INF-05 | CDK synth outputs `WebhookURL` for Alertmanager configuration | P0 |
| R-INF-06 | Webhook ingestion endpoint is authenticated (tracked — see [issue #352](https://github.com/GerMoren/junando/issues/352)) | P0 (open) |

### 10.4 Testing Requirements

| ID | Requirement | Priority |
|---|---|---|
| R-TEST-01 | Unit tests for all domain logic (fingerprint, clustering, normalizePayload) | P0 |
| R-TEST-02 | Unit tests for use-cases using mock ports | P0 |
| R-TEST-03 | Real integration tests against the local Docker/LocalStack stack (Redis, DynamoDB, SQS) | P0 |
| R-TEST-04 | E2E test: synthetic alert → webhook → pipeline → ConsoleNotifier | P1 |
| R-TEST-05 | CI runs typecheck, unit tests, and integration tests on every PR | P0 |

### 10.5 Observability Requirements (Dogfooding)

| ID | Requirement | Priority |
|---|---|---|
| R-OBS-01 | `/health` endpoint returns Lambda status | P0 |
| R-OBS-02 | Prometheus metrics endpoint at `/metrics`, IAM-SigV4-restricted | P0 |
| R-OBS-03 | One canonical wide-event log line per processed cluster, with `correlationId` | P0 |
| R-OBS-04 | `LOG_LEVEL` configurable via env var | P0 |
| R-OBS-05 | Log redaction uses a whitelist of safe fields, not a blacklist | P0 |

---

## 11. Local Development Setup

Docker Compose stack:
- **Redis**: deduplication store (local default)
- **LocalStack**: DynamoDB + SQS, for integration tests
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

## 12. Definition of Done — MVP

The MVP pipeline is complete and has been running end-to-end (real deploy, real AWS account) since the initial pilot validation:

- [x] Alertmanager fires a webhook to the deployed WebhookURL (or local `:4000`)
- [x] Lambda A validates payload with Zod, enqueues to SQS, returns quickly
- [x] Lambda B processes the alert: dedup → fingerprint → cluster → extract traces → (optional triage) → LLM inference → notification
- [x] Slack receives a Block Kit message with cluster summary, probable cause, recommended steps, and action buttons
- [x] Clicking `[Acknowledge]` is available on both the full-analysis and no-diagnosis paths
- [x] Clicking `[Trigger Rollback]` requires confirmation before any action (currently backed by a no-op handler — see [issue #319](https://github.com/GerMoren/junando/issues/319))
- [x] Dedup store failure: pipeline continues, no alerts dropped
- [x] Loki failure: cluster sent to LLM with metadata only, no traces
- [x] LLM failure: notification sent with cluster summary, no diagnosis
- [x] All unit tests pass: `pnpm test` (800+ tests)
- [x] All packages build without errors: `pnpm build`
- [x] `pnpm run typecheck` covers production and test sources across every workspace
- [x] CDK synth produces valid CloudFormation with `WebhookURL` output
- [x] First deployment succeeded on personal AWS account (`JunandoStack-pilot`)
- [x] Manual end-to-end test with real alert flow completed successfully

**Remaining for v1.0**: an external team running the full pipeline in their own staging environment and providing feedback ([issue #155](https://github.com/GerMoren/junando/issues/155)).

---

## 13. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| End-to-end alert processing time | < 90 seconds | Notification timestamp minus Alertmanager fire time |
| Zero false positives (dedup accuracy) | > 95% | Manual review of duplicate clusters |
| Deployment time (CDK) | < 5 minutes | Time from `cdk deploy` to Lambda live |
| Local dev setup time | < 10 minutes | Fresh clone to first synthetic alert |
| Pilot infra cost | < $5/month | Real AWS billing, low-volume pilot |

---

## 14. Roadmap

### v0.1 (MVP) — Done

- [x] Architecture design & documentation
- [x] Monorepo scaffold (pnpm + tsconfig + tooling)
- [x] DDD + Hexagonal architecture
- [x] `core` package: types, fingerprinting, dedup, LLM adapters, notifiers
- [x] `webhook` package: Lambda A handler (local + AWS mode)
- [x] `worker` package: Lambda B + pipeline
- [x] `cdk` package: full AWS stack
- [x] Docker Compose local dev stack
- [x] Unit tests (domain + use-cases)
- [x] First real deployment on personal AWS account
- [x] Manual end-to-end validation

### v0.2 — Done

- [x] GitHub Actions CI pipeline (lint, typecheck, test, integration test, Docker builds, Helm lint)
- [x] Automated versioned releases via changesets
- [x] Slack interactivity: acknowledge, rollback confirm dialog
- [x] Teams notifier (Adaptive Cards)
- [x] Prometheus metrics endpoint + wide-event structured logging for Junando itself
- [x] Business rules engine (suppress, route, escalate, tag by policy)
- [x] Amazon Bedrock provider (privacy-first, IAM-authenticated)
- [x] Vercel AI Gateway provider
- [x] Optional two-stage triage (cheap classify → skip expensive LLM call for low severity)
- [x] Helm chart for self-hosted/Kubernetes deployments
- [x] Interactive architecture diagram, published documentation site

### v1.0 (Production-ready) — In progress

- [ ] First external pilot team running Junando in their own staging environment (blocking issue: [#155](https://github.com/GerMoren/junando/issues/155))
- [ ] Webhook ingestion authentication and injection hardening ([#352](https://github.com/GerMoren/junando/issues/352))
- [ ] Real (non-no-op) rollback handler + hardened approval gate ([#319](https://github.com/GerMoren/junando/issues/319))
- [ ] Measured (not estimated) cost-model documentation ([#298](https://github.com/GerMoren/junando/issues/298))
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

**Differentiation**: Open-source core, bring-your-own stack, bring-your-own LLM (including a privacy-first AWS-native option via Bedrock), installs in under 60 minutes, near-zero cost during evaluation.
