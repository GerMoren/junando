# Junando

> **"Junar"** — Lunfardo rioplatense. Significa _observar atentamente, acechar con la vista._

Open-source AI-powered agent for actionable observability and incident response in distributed systems.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io)
[![Status: MVP](https://img.shields.io/badge/Status-MVP%20Development-yellow.svg)]()

---

## What It Does

Junando sits between your existing observability stack and your team's chat tool.
It watches alert streams, groups them by probable root cause using deterministic fingerprinting,
extracts only the relevant traces, and delivers a structured AI diagnosis to Slack or Teams —
with action buttons for acknowledgment and rollback.

**Core promise:** reduce hundreds of noisy alerts into a handful of actionable,
explainable incident summaries in under 90 seconds.

---

## Why Junando

Modern distributed systems generate massive telemetry but limited insight at alert time.
On-call engineers lose critical minutes correlating dashboards, logs, traces, and recent
deploys while incidents evolve.

Junando acts as a virtual Level-3 SRE available 24/7:

- Groups alerts by probable root cause — deterministic, not ML magic
- Extracts only 2-3 representative traces per incident, not full log dumps
- Uses an LLM for structured, explainable reasoning
- Delivers results in your chat tool with real action buttons
- Never acts autonomously — every destructive action requires explicit human approval

---

## Key Features

| Feature                  | Details                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| Alert deduplication      | Redis TTL window — configurable duration                                  |
| Deterministic clustering | SHA-256 fingerprint on service + error + endpoint                         |
| Bring Your Own LLM       | Gemini, Claude, OpenAI — swap via `LLM_PROVIDER` env var                  |
| Privacy-first            | Only 2-3 trace excerpts sent to LLM, never full log dumps                 |
| Stateless & cheap        | Lambda pair + SQS. Near-free on AWS free tier during dev                  |
| ChatOps-native           | Slack Block Kit with Acknowledge / Rollback / Runbook buttons             |
| On-premise ready         | Single Docker container for enterprise deployments                        |
| Zero YAML infra          | AWS CDK in TypeScript generates all CloudFormation                        |
| Hexagonal architecture   | Ports & Adapters — swap Redis, Loki, LLM or Slack without touching domain |

---

## Non-Goals

- Not a replacement for Grafana or Prometheus
- Not black-box anomaly detection or ML-based alerting
- Not autonomous remediation (every action requires human approval)
- Not a log storage solution

---

## Architecture

```
AWS Infrastructure (Lambda, ECS, API Gateway, Step Functions...)
        │
        │ OpenTelemetry SDK / Lambda Layer
        ▼
   OTel Collector
   ┌──────┴──────┐
   ▼             ▼
  Loki        Prometheus
(logs/traces)  (metrics)
                 │
           Grafana Alertmanager
                 │ POST /webhook/alert
                 ▼
   ┌─────────────────────────────┐
   │        Junando Agent        │
   │                             │
   │  Lambda A (webhook)         │  ← validates with Zod, enqueues, <50ms
   │     ↓ SQS + DLQ             │
   │  Lambda B (worker)          │  ← dedup → cluster → extract → infer → notify
   └─────────────────────────────┘
                 │
          Slack / Teams
   (diagnosis + action buttons)
```

### Internal Architecture — Hexagonal (Ports & Adapters) + DDD

```
packages/core/src/
├── domain/
│   ├── entities/          ← Alert, AlertCluster, Incident, LLMAnalysis (Zod schemas)
│   ├── value-objects/     ← Fingerprint (immutable, SHA-256 hash)
│   ├── ports/             ← IDeduplicationStore, ITraceRepository, ILLMProvider, INotifier
│   └── services/          ← ClusteringService (pure, no I/O)
├── application/
│   ├── use-cases/         ← ProcessIncidentUseCase (orchestrates via ports only)
│   └── dtos/              ← normalizePayload (Alertmanager → domain entity)
├── infrastructure/        ← concrete adapter implementations
│   ├── dedup/             ← RedisDeduplicationStore, InMemoryDeduplicationStore
│   ├── traces/            ← LokiTraceRepository, MockTraceRepository
│   ├── llm/               ← GeminiProvider, ClaudeProvider, MockLLMProvider
│   └── notifier/          ← SlackNotifier, ConsoleNotifier
└── shared/
    ├── config/            ← loadConfig() — fails fast on missing env vars
    └── logger/            ← createLogger() — Pino structured JSON
```

**The golden rule:** `domain/` has zero external imports.
No AWS SDK, no Redis, no HTTP clients. Ever.

Swapping providers means implementing the port interface and changing the factory.
No domain or application code changes.

---

## Repository Structure

```
junando/                          ← single GitHub repo
├── packages/
│   ├── core/                     ← business logic, zero AWS deps
│   ├── webhook/                  ← Lambda A: HTTP entry point
│   ├── worker/                   ← Lambda B: SQS consumer + pipeline
│   └── cdk/                      ← AWS CDK TypeScript stack
├── docker/
│   ├── docker-compose.yml        ← full local dev stack
│   ├── alertmanager/             ← points to localhost:4000
│   ├── grafana/                  ← datasources pre-configured
│   ├── loki/                     ← single-binary local config
│   └── prometheus/               ← scrapes junando /metrics (dogfooding)
├── scripts/
│   ├── dev-server.ts             ← HTTP server wrapping Lambda A on :4000
│   └── generate-alert.ts         ← synthetic alert generator for testing
├── Dockerfile                    ← single container for on-premise enterprise tier
├── .env.example                  ← template — copy to .env.local
├── AGENT.md                      ← AI assistant context (read this before coding)
└── README.md
```

---

## Tech Stack

| Layer           | Choice                                 | Why                                     |
| --------------- | -------------------------------------- | --------------------------------------- |
| Runtime         | Node.js 22+ LTS + TypeScript strict    | Mature AWS SDK, ecosystem               |
| Validation      | Zod                                    | Schema-first, full type inference       |
| Logging         | Pino                                   | Structured JSON, fastest Node.js logger |
| Queue           | AWS SQS + DLQ                          | Managed, pay-per-use, native AWS        |
| LLM             | Configurable: Gemini / Claude / OpenAI | No vendor lock-in                       |
| Traces          | Loki (LogQL)                           | Open-source standard                    |
| Metrics         | Prometheus                             | Open-source standard                    |
| ChatOps         | Slack Block Kit                        | Interactive action buttons              |
| IaC             | AWS CDK TypeScript                     | Zero YAML                               |
| Package manager | pnpm workspaces                        | Strict, fast, phantom-dep free          |
| Linter          | oxlint (pre-commit) + ESLint (CI)      | Speed + coverage                        |
| Tests           | Vitest                                 | ESM-native, fast                        |
| Architecture    | Hexagonal + DDD                        | Adapter-swappable, testable             |

---

## Quick Start — Local Development

**Requirements:** Node.js 22+, pnpm, Docker Desktop

```bash
git clone https://github.com/GerMoren/junando.git
cd junando
corepack enable && pnpm install

# Copy and fill credentials
cp .env.example .env.local

# Start observability stack (Redis, Loki, Prometheus, Grafana, Alertmanager)
pnpm run setup:local

# Build core package (required before running the webhook)
pnpm --filter @junando/core build

# Start webhook server on :4000 (watch mode)
pnpm run dev:webhook

# In a second terminal — fire synthetic alerts
pnpm run generate:alert
```

Local URLs once the stack is up:

| Service         | URL                                 | Credentials          |
| --------------- | ----------------------------------- | -------------------- |
| Grafana         | http://localhost:3000               | anonymous (no login) |
| Alertmanager    | http://localhost:9093               | —                    |
| Prometheus      | http://localhost:9090               | —                    |
| Loki API        | http://localhost:3100               | —                    |
| Junando Webhook | http://localhost:4000/webhook/alert | —                    |
| Junando Health  | http://localhost:4000/health        | —                    |
| Redis           | localhost:6379                      | —                    |

---

## Quick Start — AWS Deploy (CDK)

```bash
# Set secrets in SSM Parameter Store first
aws ssm put-parameter --name /junando/llm-provider --value "gemini" --type SecureString
aws ssm put-parameter --name /junando/llm-api-key --value "AIza..." --type SecureString
aws ssm put-parameter --name /junando/slack-bot-token --value "xoxb-..." --type SecureString
aws ssm put-parameter --name /junando/slack-signing-secret --value "..." --type SecureString
aws ssm put-parameter --name /junando/slack-channel --value "#incidents" --type SecureString
aws ssm put-parameter --name /junando/loki-url --value "https://..." --type SecureString
aws ssm put-parameter --name /junando/redis-url --value "redis://..." --type SecureString

# Build all packages
pnpm build

# Deploy
cd packages/cdk
pnpm cdk bootstrap   # first time only per account/region
pnpm cdk deploy --all

# Output will show the webhook URL — paste it in Alertmanager
```

Configure Alertmanager to send webhooks to Junando:

```yaml
receivers:
  - name: junando
    webhook_configs:
      - url: https://<lambda-function-url>/webhook/alert
        send_resolved: true
```

---

## Self-Hosted / On-Premise (Docker)

```bash
docker run -d \
  -e NODE_ENV=production \
  -e LLM_PROVIDER=gemini \
  -e LLM_API_KEY=your_key \
  -e SLACK_BOT_TOKEN=xoxb-... \
  -e SLACK_SIGNING_SECRET=... \
  -e SLACK_CHANNEL=#incidents \
  -e LOKI_URL=http://your-loki:3100 \
  -e REDIS_URL=redis://your-redis:6379 \
  ghcr.io/germoren/junando:latest
```

---

## Environment Variables

| Variable               | Required | Default          | Description                                |
| ---------------------- | -------- | ---------------- | ------------------------------------------ |
| `NODE_ENV`             | —        | `development`    | Set to `production` in AWS                 |
| `LLM_PROVIDER`         | ✓        | —                | `gemini` \| `claude` \| `openai`           |
| `LLM_API_KEY`          | ✓        | —                | API key for the chosen LLM                 |
| `LLM_MODEL`            | —        | provider default | Override model per provider                |
| `SLACK_BOT_TOKEN`      | ✓        | —                | Slack Bot Token (`xoxb-...`)               |
| `SLACK_SIGNING_SECRET` | ✓        | —                | For validating Slack interactivity         |
| `SLACK_CHANNEL`        | ✓        | —                | Target channel e.g. `#incidents`           |
| `LOKI_URL`             | ✓        | —                | Base URL of your Loki instance             |
| `REDIS_URL`            | ✓        | —                | Redis connection string                    |
| `SQS_QUEUE_URL`        | —        | —                | Injected by CDK in AWS. Empty = local mode |
| `DEDUP_TTL_SECONDS`    | —        | `300`            | Deduplication window in seconds            |
| `CLUSTER_WINDOW_MS`    | —        | `120000`         | Clustering window in milliseconds          |
| `LOG_LEVEL`            | —        | `info`           | `trace`\|`debug`\|`info`\|`warn`\|`error`  |

---

## Common Commands

```bash
# Development
pnpm run setup:local          # start Docker stack
pnpm run teardown:local       # stop and clean Docker stack
pnpm --filter @junando/core build   # compile core (required first time)
pnpm run dev:webhook          # start webhook on :4000 with watch mode
pnpm run generate:alert       # fire synthetic alert

# Quality
pnpm test                     # run all tests with Vitest
pnpm test:watch               # interactive watch mode
pnpm test:coverage            # coverage report
pnpm lint                     # oxlint on all packages
pnpm build                    # compile all packages

# CDK
pnpm cdk synth                # preview CloudFormation (no deploy)
pnpm cdk diff                 # diff local vs AWS state
pnpm cdk deploy --all         # deploy to AWS
pnpm cdk destroy --all        # tear down AWS resources
```

---

## Pipeline — How It Works

```
1. Alertmanager fires → POST /webhook/alert

2. Lambda A (webhook)
   └── Validates payload with Zod (AlertmanagerPayloadSchema)
   └── Normalizes to domain entity (NormalizedAlert)
   └── Publishes to SQS
   └── Returns 200 in <50ms

3. Lambda B (worker) — triggered by SQS
   └── Deduplication: isNew(fingerprint, ttlSeconds)
       └── Redis SET NX with TTL — skip if duplicate
   └── Clustering: group alerts by SHA-256 fingerprint
       └── fingerprint = SHA256(service|errorType|endpoint)
       └── Pick 2 representative trace IDs per cluster
   └── Trace extraction: fetch spans from Loki by trace_id
       └── Fail gracefully if Loki is unreachable
   └── LLM inference: send cluster metadata + traces
       └── Returns strict JSON: probable_cause, steps, urgency, requires_rollback
       └── Fail gracefully if LLM fails — notify without diagnosis
   └── Slack notification: Block Kit message with action buttons
       └── Retry 3x if delivery fails → then DLQ

4. On-call engineer receives Slack message
   └── [Acknowledge] — silences re-notification for 30 min
   └── [Trigger Rollback] — requires modal confirmation
   └── [View in Grafana] — deep link to dashboard
```

---

## Failure Modes (Graceful Degradation)

| Failure              | Behavior                                            |
| -------------------- | --------------------------------------------------- |
| Redis unreachable    | Skip dedup — process all alerts (noisy but safe)    |
| Loki unreachable     | Continue with alert metadata only — no traces       |
| LLM call fails       | Send cluster summary without AI diagnosis           |
| Slack delivery fails | Retry 3x with backoff → DLQ alert                   |
| Lambda B throws      | SQS retries up to 3x → DLQ → CloudWatch alarm fires |

---

## Business Model

Junando uses an **Open Source Core + Commercial** model:

| Tier         | Price       | What's included                                               |
| ------------ | ----------- | ------------------------------------------------------------- |
| Open Source  | Free        | Full agent self-hosted, Apache 2.0                            |
| Cloud Hosted | $199–499/mo | Managed deploy, config UI, incident history, multi-channel    |
| Enterprise   | From $2k/mo | On-premise, private LLM (SageMaker/Vertex AI), RBAC, SSO, SLA |

Target customer: engineering teams of 10-100 people running AWS + Grafana/Prometheus/Loki
who can't justify $100k/year for Dynatrace or Datadog AIOps.

---

## Project Status

- [x] Architecture design & documentation
- [x] Monorepo scaffold (pnpm + tsconfig + tooling)
- [x] DDD + Hexagonal architecture
- [x] `core` package: types, fingerprinting, dedup, LLM adapters, Slack
- [x] `webhook` package: Lambda A handler (local + AWS mode)
- [x] `worker` package: Lambda B + pipeline
- [x] `cdk` package: full AWS stack
- [x] Docker Compose local dev stack
- [ ] End-to-end test with real Gemini API key
- [ ] First real deployment on personal AWS account
- [ ] GitHub Actions CI pipeline
- [ ] First external pilot customer

---

## Contributing

Read `AGENT.md` before submitting a PR — it contains the architecture rules,
hard constraints, and coding conventions for this project.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
