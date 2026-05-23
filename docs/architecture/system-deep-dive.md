# Junando System Deep Dive

This document preserves the long-form technical explanation that previously lived in the root README.

Use this when you need implementation details, not onboarding.

---

## End-to-end pipeline

Junando runs a strict incident-processing sequence:

```text
Webhook -> Deduplication -> Fingerprinting -> Context Extraction -> LLM Inference -> Notification
```

Core behavior:

1. Receive Alertmanager payloads
2. Normalize into domain alerts
3. Deduplicate with Redis TTL
4. Cluster by deterministic SHA-256 fingerprint
5. Fetch representative traces
6. Enrich with LLM
7. Notify Slack or Teams

---

## High-level architecture

```text
Alertmanager / Ingest source
        |
        v
Webhook (Lambda A) -> SQS (+ DLQ) -> Worker (Lambda B)
                                  |
                                  +-> Dedup store (Redis)
                                  +-> Trace source (Loki)
                                  +-> LLM provider
                                  +-> Notifier (Slack/Teams)

Logs/metrics -> Grafana / Loki / Prometheus
```

Webhook stays minimal (validate + enqueue + return fast).
Worker owns orchestration and resilience behavior.

---

## Internal architecture (Hexagonal + DDD)

```text
packages/core/src/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── ports/
│   └── services/
├── application/
│   ├── use-cases/
│   └── dtos/
├── infrastructure/
│   ├── dedup/
│   ├── traces/
│   ├── llm/
│   ├── notifier/
│   ├── queue/
│   └── indexer/
└── shared/
    ├── config/
    ├── logger/
    └── metrics/
```

Golden rule:

- `domain/` imports no infra libraries (no Redis, AWS SDK, HTTP clients).

---

## Repository map

```text
junando/
├── packages/
│   ├── core/
│   ├── webhook/
│   ├── worker/
│   ├── ingest/
│   └── cdk/
├── docker/
├── scripts/
├── docs/
├── .env.example
├── AGENT.md
└── README.md
```

---

## Component responsibilities

### `@junando/core`

Domain entities, use cases, ports, and default adapters for dedup, traces, notifier, queue, and LLM.

### `@junando/webhook`

HTTP entrypoint compatible with Alertmanager payloads.
Validates + normalizes + enqueues.

### `@junando/worker`

Consumes queue events and executes incident pipeline end-to-end.

### `@junando/ingest`

Pull-based runtime (e.g., Loki polling or SQS subscriber).
Designed for environments where push webhooks are not the main source.

### `packages/cdk`

AWS deployment stack and wiring.

---

## Runtime constraints

- Webhook path should stay fast and side-effect light.
- Deterministic clustering before probabilistic analysis.
- LLM output must be schema-validated.
- Correlation ID must propagate end-to-end.
- Degrade gracefully when dependencies are unavailable.

---

## Failure handling model

| Failure | Expected behavior |
|---|---|
| Redis unavailable | Continue without dedup (fail-open) |
| Trace backend unavailable | Continue with alert metadata only |
| LLM failure | Send fallback incident summary |
| Notifier failure | Retry and route via DLQ/error path |
| Worker exception | SQS retry policy + DLQ |

---

## Observability model

- Structured JSON logs via Pino
- Correlation metadata attached at each stage
- Dual sinks: stdout + Loki (depending on runtime config)
- Metrics exported for throughput, errors, and latency

See also:

- `docs/structured-logging.md`
- `docs/runbooks/grafana-setup.md`
- `docs/RUNBOOK.md`

---

## Deployment and operations

### Local

- Docker Compose for local observability stack
- Scripted local runners for webhook/worker/ingest

### AWS

- CDK-managed infra
- SSM-backed config/secrets
- Queue-based reliability with DLQ

### Containers

Published images:

- `ghcr.io/germoren/junando-webhook`
- `ghcr.io/germoren/junando-worker`
- `ghcr.io/germoren/junando-ingest`

---

## Practical command set

```bash
pnpm run setup:local
pnpm --filter @junando/core build
pnpm run dev:webhook
pnpm run worker:local
pnpm run generate:alert

pnpm test
pnpm lint
pnpm build
pnpm typecheck
```

---

## Design intent

Junando is not a monitoring backend and not an APM.
It is the incident-correlation and enrichment layer that helps teams act faster with the telemetry they already have.
