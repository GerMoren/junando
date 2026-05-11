# AGENT.md — Junando Development Context

> Read this file completely before writing any code.
> This is the single source of truth for architecture decisions, constraints, and conventions.

---

## Project Identity

**Name:** Junando
**Origin:** "Junar" — Rioplatense lunfardo slang for _to observe / to watch closely_
**Tagline:** AI-powered incident intelligence for distributed systems
**License:** Apache 2.0
**Repo:** https://github.com/GerMoren/junando
**Status:** MVP active development

---

## What This System Does

Junando reduces noisy alert streams into actionable incident summaries.

Pipeline (always strictly linear — never skip or reorder steps):

```
Webhook → Deduplication → Fingerprinting → Context Extraction → LLM Inference → Notification
```

- Receives Alertmanager webhooks
- Deduplicates using Redis TTL
- Groups alerts by deterministic SHA-256 fingerprint
- Extracts 2 representative traces from Loki
- Sends cluster + traces to LLM for structured diagnosis
- Delivers Block Kit message to Slack with action buttons

---

## Architecture: Hexagonal (Ports & Adapters) + DDD

This is the most important section. Read it twice.

```
packages/core/src/
├── domain/
│   ├── entities/          Alert, AlertCluster, Incident, LLMAnalysis
│   ├── value-objects/     Fingerprint (immutable, SHA-256)
│   ├── ports/             IDeduplicationStore, ITraceRepository, ILLMProvider, INotifier
│   └── services/          ClusteringService (pure, no I/O, no external deps)
├── application/
│   ├── use-cases/         ProcessIncidentUseCase
│   └── dtos/              normalizePayload (Alertmanager → NormalizedAlert)
├── infrastructure/        concrete adapter implementations
│   ├── dedup/             RedisDeduplicationStore, InMemoryDeduplicationStore
│   ├── traces/            LokiTraceRepository, MockTraceRepository
│   ├── llm/               GeminiProvider, ClaudeProvider, MockLLMProvider, createLLMProvider()
│   └── notifier/          SlackNotifier, ConsoleNotifier
└── shared/
    ├── config/            loadConfig() — Zod-validated, fails fast
    └── logger/            createLogger() — Pino structured JSON
```

### Dependency Rules (enforced — never break these)

```
domain/      → imports NOTHING external. No AWS, no Redis, no HTTP.
application/ → imports domain ports and entities only. Never concrete adapters.
infrastructure/ → imports domain ports to implement them. AWS SDK lives here.
webhook/     → imports @junando/core. Contains Lambda A handler.
worker/      → imports @junando/core. Contains Lambda B handler + wires dependencies.
cdk/         → imports aws-cdk-lib only. Defines all AWS infrastructure.
```

**The test:** if you see `import Redis from 'ioredis'` inside `domain/`, something is wrong.

### Swapping a provider = implementing a port

```
Swap Gemini for Claude    → implement ILLMProvider → change factory in worker
Swap Loki for Datadog     → implement ITraceRepository → change factory in worker
Swap Redis for DynamoDB   → implement IDeduplicationStore → change factory in worker
Swap Slack for Teams      → implement INotifier → change factory in worker
```

No domain or application code changes when swapping infrastructure.

---

## Monorepo Structure

```
junando/                          single GitHub repo
├── packages/
│   ├── core/                     @junando/core — business logic, zero AWS deps
│   ├── webhook/                  @junando/webhook — Lambda A
│   ├── worker/                   @junando/worker — Lambda B
│   └── cdk/                      @junando/cdk — AWS CDK TypeScript
├── docker/
│   ├── docker-compose.yml
│   ├── alertmanager/alertmanager.yml
│   ├── grafana/datasources.yml
│   ├── loki/loki-config.yml
│   └── prometheus/prometheus.yml
├── scripts/
│   ├── dev-server.ts             local HTTP server wrapping Lambda A on :4000
│   └── generate-alert.ts         synthetic alert generator
├── Dockerfile
├── .env.example
├── .env.local                    ← NEVER commit this file
├── package.json                  workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── .prettierrc.json
├── AGENT.md
└── README.md
```

---

## Tech Stack Decisions (final — do not reopen)

| Layer                          | Decision                               | Reason                                                 |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------ |
| Runtime                        | Node.js 22+ LTS                        | AWS SDK v3, ecosystem maturity                         |
| Language                       | TypeScript strict                      | No `any`, exact optional properties                    |
| Package manager                | pnpm workspaces                        | Strict deps, no phantom dependencies                   |
| Validation                     | Zod                                    | Schema-first, full type inference, parse at boundaries |
| Logging                        | Pino                                   | Structured JSON, fastest Node.js logger                |
| Queue                          | AWS SQS + DLQ                          | Managed, pay-per-use, native AWS, no infra to manage   |
| LLM (MVP)                      | Gemini 2.0 Flash                       | Cheapest, 1M token context, swappable via adapter      |
| Traces                         | Loki (LogQL)                           | Open-source standard                                   |
| Metrics                        | Prometheus                             | Open-source standard                                   |
| Alerting                       | Grafana Alertmanager                   | Standard webhook integration                           |
| ChatOps                        | Slack Block Kit                        | Action buttons for interactive remediation             |
| Secrets                        | AWS SSM Parameter Store (SecureString) | Free for standard params, least-privilege IAM          |
| IaC                            | AWS CDK TypeScript                     | Zero YAML, type-safe, generates CloudFormation         |
| Tests                          | Vitest                                 | ESM-native, fast, Jest-compatible API                  |
| Linter                         | oxlint (pre-commit)                    | 50-100x faster than ESLint                             |
| Build                          | tsup                                   | esbuild-based, ESM + CJS output                        |
| Web server (local)             | Node.js http module                    | No framework needed for single-route dev server        |
| Web server (enterprise Docker) | Fastify                                | Persistent server, schema validation, plugins          |

**Decisions NOT to reopen:**

- Kafka: overkill, designed for millions of events/sec streaming with replay. Not needed here.
- RabbitMQ: complex routing not needed. SQS covers the use case.
- BullMQ: replaced by SQS. Redis already used for dedup — don't add queue responsibility.
- Express: use Fastify for the Docker/enterprise tier if needed. Not for Lambda.

---

## Hard Constraints (non-negotiable)

1. **Webhook response < 50ms.** Lambda A validates, enqueues, returns 200. No pipeline logic.
2. **Deterministic before AI.** Fingerprinting is SHA-256 hash — no ML, no randomness.
3. **JSON-only LLM output.** Always request structured JSON. Always validate with Zod.
4. **Token budget: < 8,000 tokens per LLM call.** Max 30 trace spans per cluster.
5. **No autonomous destructive actions.** Rollback requires explicit human approval via Slack modal.
6. **Fail gracefully.** Loki down → continue. LLM down → notify without diagnosis. Never block webhook.
7. **No `any` in TypeScript.** Use `unknown` + Zod parse at every external boundary.
8. **domain/ has zero external imports.** This is enforced by architecture, not by linter.

---

## Fingerprinting Algorithm (v1)

```typescript
fingerprint = SHA256(
  serviceName.toLowerCase().trim() +
    '|' +
    errorType.toLowerCase().trim() +
    '|' +
    endpointPath.toLowerCase().trim(),
);
```

Two alerts share a fingerprint = same probable root cause.
Fingerprint is the cluster key. Dedup key prefix: `junando:dedup:{fingerprint}`.

Representative sample selection (per cluster):

1. First alert chronologically (earliest signal)
2. Alert with highest latency (worst-case context)
   Maximum 2 trace IDs per cluster sent to LLM.

---

## LLM Output Schema (strict — never change without updating Zod schema)

The LLM must return ONLY a valid JSON object with this exact shape:

```json
{
  "probable_cause": "string — concise root cause description",
  "impacted_services": ["string"],
  "recommended_steps": ["string", "max 5 items"],
  "urgency_level": "low | medium | high | critical",
  "requires_rollback": true
}
```

System prompt persona: senior SRE performing incident triage.
Parse response with `LLMAnalysisSchema.parse()`. If parsing fails: send cluster summary without diagnosis.

---

## Failure Handling

| Component fails | Behavior                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| Redis           | Fail open — treat every alert as new. Process duplicates, don't drop.       |
| Loki            | Continue pipeline with alert metadata only. Log warning with correlationId. |
| LLM             | Send Slack message with cluster summary and no AI diagnosis section.        |
| Slack           | Retry 3x with exponential backoff. Then throw — SQS retries Lambda B.       |
| Lambda B throws | SQS retries up to 3 times. After 3 failures → DLQ. CloudWatch alarm fires.  |

---

## Environment Variables

### Required in all environments

| Variable               | Description                                  |
| ---------------------- | -------------------------------------------- |
| `LLM_PROVIDER`         | `gemini` \| `claude` \| `openai`             |
| `LLM_API_KEY`          | API key for the chosen provider              |
| `SLACK_BOT_TOKEN`      | Slack Bot Token (`xoxb-...`)                 |
| `SLACK_SIGNING_SECRET` | For validating Slack interactivity callbacks |
| `SLACK_CHANNEL`        | Target channel e.g. `#incidents`             |
| `LOKI_URL`             | Base URL of Loki instance                    |
| `REDIS_URL`            | Redis connection string                      |

### Optional

| Variable            | Default          | Description                       |
| ------------------- | ---------------- | --------------------------------- |
| `LLM_MODEL`         | provider default | Override specific model           |
| `SQS_QUEUE_URL`     | empty            | If empty → local mode (no SQS)    |
| `DEDUP_TTL_SECONDS` | `300`            | Dedup window in seconds           |
| `CLUSTER_WINDOW_MS` | `120000`         | Clustering window in ms           |
| `LOG_LEVEL`         | `info`           | Pino log level                    |
| `NODE_ENV`          | `development`    | Set to `production` in AWS Lambda |
| `PORT`              | `4000`           | Local dev server port             |

### Local mode detection

Lambda A handler enters local mode when:

```typescript
const isLocal = !process.env['SQS_QUEUE_URL'] || process.env['NODE_ENV'] === 'development';
```

In local mode: processes pipeline inline, uses InMemoryDeduplicationStore and MockTraceRepository.

### SSM Parameter Store paths (AWS production)

```
/junando/llm-provider
/junando/llm-api-key
/junando/slack-bot-token
/junando/slack-signing-secret
/junando/slack-channel
/junando/loki-url
/junando/redis-url
```

---

## Common Commands

```bash
# First time setup
pnpm install
cp .env.example .env.local
pnpm run setup:local
pnpm --filter @junando/core build

# Daily development
pnpm run dev:webhook              # start local server on :4000 (watch mode)
pnpm run generate:alert           # fire synthetic alert to localhost:4000
pnpm test                         # run all tests
pnpm test:watch                   # interactive test mode
pnpm lint                         # oxlint all packages
pnpm build                        # compile all packages

# Debugging
curl http://localhost:4000/health  # verify webhook is running
redis-cli keys "junando:*"        # inspect dedup keys in Redis

# CDK (AWS)
cd packages/cdk
pnpm cdk synth                    # preview CloudFormation
pnpm cdk diff                     # diff local vs deployed
pnpm cdk deploy --all             # deploy to AWS
pnpm cdk destroy PharoStack-dev   # tear down dev stack
```

---

## Local Dev URLs

| Service         | URL                                 |
| --------------- | ----------------------------------- |
| Grafana         | http://localhost:3000               |
| Alertmanager    | http://localhost:9093               |
| Prometheus      | http://localhost:9090               |
| Loki            | http://localhost:3100               |
| Junando Webhook | http://localhost:4000/webhook/alert |
| Junando Health  | http://localhost:4000/health        |
| Redis           | localhost:6379                      |

---

## Code Style & Conventions

```typescript
// ✓ Named exports preferred
export function fingerprint(alert: NormalizedAlert): string { ... }

// ✓ Default export only for Lambda handlers
export const handler = async (event: Event): Promise<Result> => { ... }

// ✓ No classes in domain logic — pure functions
// ✓ Classes only for adapters implementing ports (adapter pattern)

// ✓ Zod at every external boundary
const parsed = AlertmanagerPayloadSchema.safeParse(raw)
if (!parsed.success) { ... }

// ✓ No any — use unknown + parse
function processRaw(data: unknown): NormalizedAlert { ... }

// ✓ correlationId in every log
logger.info({ correlationId, fingerprint }, 'Cluster processed')

// ✓ Explicit return types on public functions
export async function isNewAlert(fp: string, ttl: number): Promise<boolean> { ... }
```

---

## Testing Strategy

| Module                                   | Test type   | Tools                                                |
| ---------------------------------------- | ----------- | ---------------------------------------------------- |
| `domain/value-objects/fingerprint`       | Unit        | Vitest, pure functions                               |
| `domain/services/clustering.service`     | Unit        | Vitest, pure functions                               |
| `application/use-cases/process-incident` | Unit        | Vitest, mock ports                                   |
| `application/dtos/normalize-payload`     | Unit        | Vitest, fixture payloads                             |
| `infrastructure/dedup`                   | Unit        | InMemoryDeduplicationStore                           |
| `infrastructure/llm`                     | Unit        | MockLLMProvider                                      |
| `infrastructure/traces`                  | Unit        | MockTraceRepository                                  |
| `webhook/handler`                        | Integration | Mock SQS + real Zod validation                       |
| Full pipeline                            | E2E         | generate-alert.ts → localhost:4000 → ConsoleNotifier |

Run `pnpm test:coverage` to see coverage report. Minimum thresholds: 80% lines, 80% functions.

---

## AWS Infrastructure (CDK Stack)

Resources defined in `packages/cdk/lib/junando-stack.ts`:

| Resource         | Config                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| SQS Queue        | `junando-alerts`, 4-day retention, visibility timeout = Lambda B timeout |
| SQS DLQ          | `junando-alerts-dlq`, 14-day retention, redrive after 3 failures         |
| Lambda A         | 256MB, 5s timeout, Node.js 22, Function URL (no API Gateway)             |
| Lambda B         | 512MB, 3min timeout, Node.js 22, SQS event source mapping (batch=1)      |
| CloudWatch Alarm | DLQ depth > 0 → alert (pipeline failing)                                 |
| SSM Parameters   | Read-only access via IAM, /junando/\* path prefix                        |

CDK outputs after deploy:

- `WebhookURL` — paste this in Alertmanager `webhook_configs.url`
- `QueueURL` — SQS queue URL

---

## Business Context

**Target customer:** Engineering teams of 10-100 people running AWS + open-source observability
(Grafana, Prometheus, Loki) who can't justify $100k/year enterprise AIOps tools.

**Competitors:** Dynatrace, Datadog AIOps, Moogsoft, BigPanda.
All enterprise-only, expensive, require vendor lock-in.

**Differentiator:** Open-source core, bring-your-own stack, bring-your-own LLM,
installs in under 60 minutes, near-zero cost on AWS free tier during evaluation.

**Revenue model:**

- Tier 1 Open Source: free, self-hosted, Apache 2.0
- Tier 2 Cloud Hosted: $199-499/month, managed
- Tier 3 Enterprise: $2k+/month, on-premise, private LLM, SLA

---

## Code Architecture Rules

These are enforced. Violations are bugs, not style preferences.

### 1. No switch-case

Use `Map` registries instead of `switch`. Factory functions must use `ReadonlyMap.get()`.

```typescript
// ✗ WRONG
switch (provider) {
  case 'gemini': return new GeminiProvider(...);
  case 'claude': return new ClaudeProvider(...);
  default: throw new Error(...);
}

// ✓ CORRECT
const PROVIDER_REGISTRY: ReadonlyMap<string, (apiKey: string) => Provider> = new Map([
  ['gemini', (key) => new GeminiProvider(key)],
  ['claude', (key) => new ClaudeProvider(key)],
]);
const factory = PROVIDER_REGISTRY.get(provider);
if (!factory) throw new Error(...);
return factory(apiKey);
```

This applies to ALL code: domain, application, infrastructure, scripts.

### 2. No hardcoded values

Every magic number, magic string, and URL belongs in `packages/core/src/shared/constants.ts`.

```typescript
// ✗ WRONG
const res = await fetch('https://slack.com/api/chat.postMessage', { signal: AbortSignal.timeout(5000) });

// ✓ CORRECT — defined once in constants.ts
import { SLACK_API_URL, HTTP_TIMEOUT_MS } from '../shared/constants.js';
const res = await fetch(SLACK_API_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.Default) });
```

Every constant must be typed and named. Numeric constants must use `Object.freeze()` groups with trailing comma separators (`5_000` notation).

### 3. TypeScript superpowers — use them all

Never use a TypeScript feature "just because" — use it because it makes code safer.

| Feature | When to use |
| ------- | ------------ |
| `enum` | Closed sets of values used in multiple files (`AlertType`, `LLMProviderType`) |
| Union types | Closed sets in single-file or Zod schemas |
| `z.nativeEnum(TEnum)` | Schema validation of TypeScript enums |
| Discriminated unions | State machines, multi-variant results |
| Template literal types | Parameterized string patterns (`LogLevel`, etc.) |
| `Readonly<T>` | Function parameters that must not be mutated |
| `ReadonlyMap` | All factory registries (from rule #1) |
| `const` assertions | Inline object maps (`as const`) |
| Type guards | Narrowing union types at runtime |
| `z.infer<typeof Schema>` | Always derive types from Zod, never re-declare |
| Utility types (`Partial`, `Pick`, `Omit`, `Record`) | DTO transformations and optional fields |
| `Object.freeze()` | All constants objects — prevents accidental mutation |

### 4. AlertType is the only required enum

All alert classification uses `AlertType` enum (`Error | Warning | Success`). No raw strings like `'http_500'` or `'latency_spike'` outside of the constants definition. The `error_type` label from Alertmanager maps to `AlertType` via `ERROR_TYPE_TO_ALERT_TYPE` lookup in `normalize-payload.ts`.

---

## Guiding Principles

1. **Prefer clarity over cleverness.** Code is read at 3am by tired engineers.
2. **Design for on-call.** Every output — logs, Slack messages, error messages — should be actionable.
3. **Fail gracefully, always.** Partial results are better than no results.
4. **The domain is sacred.** Never let infrastructure concerns leak into domain logic.
5. **Test the logic, mock the I/O.** Pure functions are a gift — keep them pure.
6. **One responsibility per module.** If a file needs a long comment to explain what it does, split it.
