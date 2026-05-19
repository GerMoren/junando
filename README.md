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
| Bring Your Own LLM       | Gemini, Claude, OpenRouter, Qwen — swap via `LLM_PROVIDER` env var        |
| Structured logging       | Pino JSON to stdout (CloudWatch) + Grafana Cloud Loki, with correlationId |
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
AWS Infrastructure (Lambda, ECS, API Gateway...)
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
   ┌──────────────────────────────────────┐
   │           Junando Agent              │
   │                                      │
   │  Lambda A (webhook)                  │  ← validates, enqueues, <50ms
   │     ↓ SQS + DLQ                      │
   │  Lambda B (worker)                   │  ← dedup → cluster → extract → infer → notify
   │                                      │
   │  Ingest service (optional)           │  ← polls Loki directly via LogQL
   │     ↓ ProcessIncidentUseCase         │     no Alertmanager required
   └──────────────────────────────────────┘
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
│   ├── ingest/                   ← @junando/ingest — Loki polling adapter
│   └── cdk/                      ← AWS CDK TypeScript stack
├── docker/
│   ├── docker-compose.yml        ← full local dev stack (name: junando)
│   ├── docker-compose.prod.yml   ← production compose (webhook + worker + ingest + redis)
│   ├── docker-compose.prod.local.yml  ← override for local images
│   ├── docker-compose.localstack.yml  ← optional LocalStack SQS helper for ingest local-dev
│   ├── Dockerfile.webhook        ← multi-stage image for junando-webhook
│   ├── Dockerfile.worker         ← multi-stage image for junando-worker
│   ├── Dockerfile.ingest         ← multi-stage image for junando-ingest
│   ├── ingest.config.example.yaml     ← template for Loki ingest rules (Grafana Cloud)
│   ├── ingest.config.local.yaml  ← local dev Loki rules (points to localhost:3100)
│   ├── ingest.config.sqs.example.yaml ← template for generic SQS ingest
│   ├── ingest.config.sqs.local.yaml   ← LocalStack-friendly SQS ingest config
│   ├── alertmanager/             ← points to localhost:4000
│   ├── grafana/                  ← datasources pre-configured
│   ├── loki/                     ← single-binary local config
│   └── prometheus/               ← scrapes junando /metrics (dogfooding)
├── scripts/
│   ├── dev-server.ts             ← HTTP server wrapping Lambda A on :4000
│   ├── worker-server.ts          ← SQS polling loop for local worker
│   ├── worker-local.ts           ← run ProcessIncidentUseCase directly (no SQS)
│   ├── ingest-server.ts          ← composition root for junando-ingest service
│   ├── ingest-local.ts           ← single-tick ingest test against local Loki
│   ├── ingest/
│   │   ├── runtime.ts            ← Loki vs SQS runtime selection seam
│   │   └── processors/           ← source-specific queue processors (for example Cenco)
│   ├── generate-alert.ts         ← synthetic alert generator (Alertmanager format)
│   ├── simulate-incident.ts      ← full incident simulation (local or webhook target)
│   └── factories/
│       └── process-incident.factory.ts  ← shared wiring for ProcessIncidentUseCase
├── .env.example                  ← template — copy to .env.local
├── AGENT.md                      ← AI assistant context (read this before coding)
└── README.md
```

---

## Tech Stack

| Layer           | Choice                                            | Why                                         |
| --------------- | ------------------------------------------------- | ------------------------------------------- |
| Runtime         | Node.js 22+ LTS + TypeScript strict               | Mature AWS SDK, ecosystem                   |
| Validation      | Zod                                               | Schema-first, full type inference           |
| Logging         | Pino                                              | Structured JSON, fastest Node.js logger     |
| Queue           | AWS SQS + DLQ                                     | Managed, pay-per-use, native AWS            |
| LLM             | Configurable: Gemini / Claude / OpenRouter / Qwen | Free tier via OpenRouter, no vendor lock-in |
| Traces          | Loki (LogQL)                                      | Open-source standard                        |
| Metrics         | Prometheus                                        | Open-source standard                        |
| ChatOps         | Slack Block Kit                                   | Interactive action buttons                  |
| IaC             | AWS CDK TypeScript                                | Zero YAML                                   |
| Package manager | pnpm workspaces                                   | Strict, fast, phantom-dep free              |
| Linter          | oxlint (pre-commit) + ESLint (CI)                 | Speed + coverage                            |
| Tests           | Vitest                                            | ESM-native, fast                            |
| Architecture    | Hexagonal + DDD                                   | Adapter-swappable, testable                 |

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

## Docker Images

Images are published to GitHub Container Registry (`ghcr.io`) automatically:

| Event           | Tags published                                              | Use case                                  |
| --------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Merge to `main` | `:main`, `:sha-<short>`                                     | Bleeding edge — latest unreleased changes |
| Push `v*` tag   | `:latest`, `:<version>`, `:<major>.<minor>`, `:sha-<short>` | Stable release                            |

```bash
# Stable release (recommended for production)
docker pull ghcr.io/germoren/junando-webhook:latest
docker pull ghcr.io/germoren/junando-worker:latest
docker pull ghcr.io/germoren/junando-ingest:latest

# Bleeding edge (main branch)
docker pull ghcr.io/germoren/junando-webhook:main
docker pull ghcr.io/germoren/junando-ingest:main

# Pin to a specific commit
docker pull ghcr.io/germoren/junando-webhook:sha-a1b2c3d
```

To publish a new release:

```bash
git tag v0.3.0
git push origin v0.3.0
```

---

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

| Variable               | Required  | Default          | Description                                                                                                       |
| ---------------------- | --------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | —         | `development`    | Set to `production` in AWS (required for Lambda deploy)                                                           |
| `SSM_PREFIX`           | AWS only  | —                | E.g. `/junando`. When set, secrets are loaded from SSM at startup                                                 |
| `LLM_PROVIDER`         | ✓         | —                | `gemini` \| `claude` \| `openrouter` \| `qwen`                                                                    |
| `LLM_API_KEY`          | ✓         | —                | API key for the chosen LLM                                                                                        |
| `LLM_MODEL`            | —         | provider default | Override model (e.g. `google/gemma-4-31b-it:free` for OpenRouter)                                                 |
| `SLACK_BOT_TOKEN`      | ✓ (slack) | —                | Slack Bot Token (`xoxb-...`). Required when `NOTIFIER_TYPE=slack`                                                 |
| `SLACK_SIGNING_SECRET` | ✓ (slack) | —                | For validating Slack interactivity. Required when `NOTIFIER_TYPE=slack`                                           |
| `SLACK_CHANNEL`        | ✓ (slack) | —                | Target channel e.g. `#incidents`. Required when `NOTIFIER_TYPE=slack`                                             |
| `NOTIFIER_TYPE`        | —         | `slack`          | `slack` \| `teams` — selects the notification backend                                                             |
| `TEAMS_WEBHOOK_URL`    | ✓ (teams) | —                | Power Automate workflow webhook URL. Required when `NOTIFIER_TYPE=teams`. Must include `api-version=` query param |
| `LOKI_URL`             | ✓         | —                | Loki push URL with embedded credentials — see Observability                                                       |
| `REDIS_URL`            | ✓         | —                | Redis connection string                                                                                           |
| `SQS_QUEUE_URL`        | —         | —                | Injected by CDK in AWS. Empty = local mode                                                                        |
| `DEDUP_TTL_SECONDS`    | —         | `300`            | Deduplication window in seconds                                                                                   |
| `CLUSTER_WINDOW_MS`    | —         | `120000`         | Clustering window in milliseconds                                                                                 |
| `LOG_LEVEL`            | —         | `info`           | `trace`\|`debug`\|`info`\|`warn`\|`error`                                                                         |

---

## Teams Notifier Setup

Junando supports Microsoft Teams as a notification backend via Power Automate Workflow webhooks.

### Requirements

1. **Create a Power Automate Workflow** — use the "Post to a channel" template with an HTTP trigger.
2. **Copy the webhook URL** — it looks like:

   ```
   https://prod-XX.westus.logic.azure.com/workflows/.../invoke?api-version=2024-10-01&sp=...&sv=...&sig=...
   ```

   > ⚠️ The URL **must** include the `api-version=` query parameter. Microsoft changes the value periodically — Junando accepts any value, so you don't need to update it.

3. **Set environment variables**:
   ```bash
   NOTIFIER_TYPE=teams
   TEAMS_WEBHOOK_URL=https://prod-XX.powerautomate.com/workflows/.../invoke?api-version=2024-10-01&sp=...
   ```

### Webhook Behavior

- Junando sends an [Adaptive Card v1.5](https://adaptivecards.io/) payload wrapped in the Teams `message` envelope.
- The webhook returns **HTTP 202 Accepted** — Junando treats both 200 and 202 as success.
- Timeout defaults to **10 seconds** (`TEAMS_WEBHOOK_TIMEOUT_MS`). SQS handles retries on timeout.
- The full webhook URL (including the `sig=` secret) is **never logged**. Only the hostname is included in error messages.

### Existing Slack Deployments

Setting `NOTIFIER_TYPE` is optional — it defaults to `slack`. Existing Slack deployments continue to work without any changes.

---

## Observability

Junando emits structured JSON logs (Pino) with a `correlationId` propagated through the
full pipeline — webhook → SQS → worker → LLM → notifier. Logs ship to two sinks:

- **stdout** → CloudWatch Logs (always on, free with Lambda)
- **Grafana Cloud Loki** → for cross-service correlation and long-term querying

### Loki transport

The Loki sink is a **custom in-process buffered transport** (`loki-transport.ts`),
not `pino-loki`. Reason: `pino-abstract-transport` runs in a `worker_thread` that
Lambda kills before the 5s batch flush completes, so logs were silently lost.

- Buffers up to 1000 entries in a ring buffer (drops oldest on overflow → no OOM)
- Flushed synchronously via `flushLoki()` at the end of every handler (`try/finally`)
- One HTTP request per Lambda invocation

### `LOKI_URL` format

Use the Grafana Cloud push endpoint **with embedded credentials**:

```
https://<USER>:<TOKEN>@logs-prod-XXX.grafana.net/loki/api/v1/push
```

Notes:

- The Grafana Cloud token must have the `logs:write` scope
- New tokens take **up to 15 minutes** to propagate
- Zod's `.url()` validator rejects `user:pass@` — `lokiUrl` uses a plain string check on purpose

### LLM observability

`OpenRouterProvider.analyze` emits per-call structured logs with model name,
prompt/completion tokens, total tokens, and latency in ms. On HTTP 429 it retries
once with backoff (uses `retry_after_seconds` if the provider returns it, else 5s,
capped at 30s) — verified against `google/gemma-4-31b-it:free`.

### Grafana Dashboards

Three portable, importable dashboard JSONs are available in [`docs/dashboards/`](docs/dashboards/):

| Dashboard                                                      | Description                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`alert-volume.json`](docs/dashboards/alert-volume.json)       | Webhook throughput, alert received/processed rates, duplicate rate |
| [`llm-performance.json`](docs/dashboards/llm-performance.json) | LLM p50/p99 latency, 429 error rate, fallback hops, token usage    |
| [`sqs-health.json`](docs/dashboards/sqs-health.json)           | SQS queue/DLQ depth (CloudWatch) + worker error logs (Loki)        |

For setup instructions, see **[docs/runbooks/grafana-setup.md](docs/runbooks/grafana-setup.md)**.

For failure scenarios, LogQL queries, and recovery procedures, see **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

For the required JSON log schema, PII redaction rules, and LogQL query examples, see **[docs/structured-logging.md](docs/structured-logging.md)**.

---

## Common Commands

```bash
# Development
pnpm run setup:local          # start Docker stack (Redis, Loki, Prometheus, Grafana, Alertmanager)
pnpm run teardown:local       # stop and clean Docker stack
pnpm --filter @junando/core build   # compile core (required first time)
pnpm run dev:webhook          # start webhook on :4000 with watch mode
pnpm run worker:local         # run worker pipeline locally (no SQS)

# Alert simulation
pnpm run generate:alert                  # fire a synthetic Alertmanager alert (local)
pnpm run simulate:incident               # full incident simulation via worker-local
pnpm run simulate:incident -- --target=webhook   # send to running webhook on :4000
pnpm run simulate:incident -- --scenario=db_outage --target=webhook
pnpm run simulate:incident -- --scenario=bad_deploy --mock   # skip real LLM

# Loki ingest (log polling)
pnpm run ingest:local                                    # single tick against local Loki, mock LLM
pnpm run ingest:local -- --config ./docker/ingest.config.local.yaml   # explicit config
pnpm run ingest:local -- --real-llm                      # use real LLM from .env.local
pnpm run ingest:dev                                      # continuous polling loop (local)

# SQS ingest (LocalStack helper)
# Add AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
# INGEST_CONFIG_PATH=./docker/ingest.config.sqs.local.yaml to .env.local
docker compose -f docker/docker-compose.localstack.yml up -d
pnpm run ingest:sqs:local                                # run ingest-server using .env.local

# Quality
pnpm test                     # run all tests with Vitest
pnpm test:watch               # interactive watch mode
pnpm test:coverage            # coverage report
pnpm lint                     # oxlint on all packages
pnpm build                    # compile all packages
pnpm typecheck                # tsc --noEmit across workspace

# Docker (local images)
docker build -f docker/Dockerfile.webhook -t junando-webhook:local .
docker build -f docker/Dockerfile.worker  -t junando-worker:local  .
docker build -f docker/Dockerfile.ingest  -t junando-ingest:local  .
docker compose -f docker/docker-compose.prod.yml -f docker/docker-compose.prod.local.yml up -d

# Optional LocalStack queue for SQS ingest local-dev
# Put the SQS local env vars in .env.local
# Queue bootstrap: docker/localstack/init/10-create-sqs-queue.sh
# Config: docker/ingest.config.sqs.local.yaml

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
- [x] Docker images published to GHCR (webhook, worker, ingest) — `ghcr.io/germoren/junando-*`
- [x] Auto-build on merge to `main` → `:main` + `:sha-*` tags (issue #26)
- [x] `ingest` package: Loki log polling adapter — `@junando/ingest` v1 (issue #23)
- [x] `ingest-local` script: single-tick test against local Loki with mock LLM
- [x] Structured logging guide — `docs/structured-logging.md`
- [ ] CloudWatch Logs ingestion adapter (issue #28)
- [ ] End-to-end test with Cenco prod environment
- [ ] First real deployment on personal AWS account
- [ ] GitHub Actions CI pipeline (tests + lint on PR)

---

## Contributing

Read `AGENT.md` before submitting a PR — it contains the architecture rules,
hard constraints, and coding conventions for this project.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
