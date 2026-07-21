# Wide Events — Canonical Log Lines

> **One structured log line per processing unit instead of scattered `logger.info()` calls.**

Junando uses **wide events** (also called canonical log lines) as its primary observability strategy. Every meaningful unit of work — processing a cluster, running LLM inference, sending a notification — produces exactly one structured JSON line at the end of the unit.

This document explains the philosophy, the event schema, how to add new events, and how to operate the system.

---

## Table of Contents

- [Philosophy](#philosophy)
- [Event Schema](#event-schema)
- [Field Taxonomy](#field-taxonomy)
- [Pipeline Components](#pipeline-components)
- [Tail Sampling](#tail-sampling)
- [PII Redaction](#pii-redaction)
- [How to Add a Wide Event](#how-to-add-a-wide-event)
- [How to Query Wide Events (Loki)](#how-to-query-wide-events-loki)
- [Feature Flag: WIDE_EVENTS_ENABLED](#feature-flag-wide_events_enabled)
- [Comparison: Wide Events vs. Scattered Logs](#comparison-wide-events-vs-scattered-logs)

---

## Philosophy

Traditional logging scatters information across many lines: one for "dedup started", one for "dedup finished", one for "LLM request sent", one for "notification delivered". Each line carries a slice of context, and correlating them requires matching timestamps or request IDs across multiple log streams. This approach is fragile, hard to query, and loses the relationship between stages.

**Wide events** invert this pattern. Instead of logging *activity*, you log *results*:

- One line per cluster at the end of `ProcessIncidentUseCase.execute()`
- One accumulate builder passed through pipeline stages
- Each stage writes its result (not its activity) into the builder
- The final event captures the complete chain: dedup → traces → LLM → notify

### Benefits

| Concern | Scattered logs | Wide events |
|---------|---------------|-------------|
| Query cost | N LogQL queries per trace | 1 LogQL query, filter by `requestId` |
| Field collisions | `service: "junando"` everywhere | `component: "dedup"` distinct per stage |
| Missing context | Implicit — log lines are disconnected | Explicit — one event has the full chain |
| Volume | Unbounded per processing unit | Exactly 1 per unit (tail-sampled) |
| Debugging | Follow the breadcrumbs | Every answer is in one JSON object |

> This approach is inspired by the [loggingstuck](https://loggingsuck.substack.com/) philosophy: log wide events, not narrow ones.

---

## Event Schema

```typescript
interface WideEvent {
  requestId: string;            // correlationId:fingerprint — unique per cluster
  component: Component;         // which pipeline stage emitted this event
  timestamp: string;            // ISO 8601 — when the event was flushed
  correlationId?: string;       // end-to-end trace ID (from Alertmanager or generated)
  outcome?: Outcome;            // success | degraded | error | suppressed | ...
  durationMs?: number;          // wall-clock time for this processing unit
  version?: string;             // schema version (future use)

  // Pipeline stage sections (present only when the stage ran)
  cluster?: ClusterSection;
  dedup?: DedupSection;
  rule?: RuleSection;
  llm?: LlmSection;
  notify?: NotifySection;
  error?: ErrorSection;

  // Size guard
  _truncated?: boolean;         // true when the 256 KB limit was hit
}
```

Each section carries exactly the fields needed to understand that stage's outcome — no more, no less.

### ClusterSection

```typescript
{
  fingerprint: string;          // alert cluster fingerprint
  serviceName: string;          // from the alert labels
  alertCount: number;           // alerts in this cluster
  spanCount: number;            // representative traces fetched
  traceErrors?: number;         // traces that failed to fetch (fail-open count)
}
```

### DedupSection

```typescript
{
  isNew: boolean;               // true = first time seeing this fingerprint
  ttlSeconds: number;           // dedup window
  error?: string;               // fail-open message when Redis was unreachable
}
```

### RuleSection

```typescript
{
  matched: boolean;             // a rule matched this cluster
  suppressed: boolean;          // cluster was suppressed (no notification sent)
  matchedRuleId?: string;       // ID of the rule that matched
}
```

### LlmSection

```typescript
{
  provider: string;             // gemini | claude | openrouter
  model: string;                // model name (e.g. gemini-2.5-flash)
  latencyMs: number;            // wall-clock time of the LLM call
  urgency: string;              // LOW | MEDIUM | HIGH | CRITICAL
  tokens: number;               // prompt + completion tokens
}
```

### NotifySection

```typescript
{
  channels: string[];           // notification targets (Slack channels, Teams webhooks)
  outcome: string;              // "success" | "failure"
  latencyMs: number;            // wall-clock time of all notification calls
}
```

### ErrorSection

```typescript
{
  message: string;              // error message (truncated at 1000 chars)
  name?: string;                // error class name
  stack?: string;               // stack trace — PRODUCTION-REDACTED outside development
}
```

---

## Field Taxonomy

A key design decision: **`component`** (not `service`) identifies which pipeline stage produced the event.

| Field | Example value | Purpose |
|-------|--------------|---------|
| `service` (Loki label) | `junando` | Infrastructure routing — which app emitted the log |
| `component` (log field) | `useCase`, `webhook`, `worker`, `llm` | Logical stage inside the app |

This avoids the collision that existed in the legacy log system, where every Pino logger set `service: "junando"` making it impossible to distinguish stages in LogQL queries.

---

## Pipeline Components

| Component | Source | When it emits |
|-----------|--------|---------------|
| `useCase` | `ProcessIncidentUseCase` | Once per non-duplicate cluster (after dedup, LLM, and notify) |
| `webhook` | Webhook Lambda | Boundary validation — forwards to SQS (wide event deferred to use case) |
| `worker` | Worker Lambda | Batch ingestion — delegates to use case per record |
| `llm` | LLM provider adapters | LLM call result (latency, model, tokens) |
| `notifier` | Notifier adapters | Notification delivery result (channels, outcome) |
| `dedup` | Dedup store adapters | Dedup decision (isNew, ttl, Redis fail) |
| `traces` | Trace repository adapters | Trace fetch result (span count, errors) |
| `ingest` | Pull-based ingesters | Batch poll result |

The **use case** (`component: "useCase"`) is the primary event producer — it accumulates all stage results and emits one event per cluster. Other components emit auxiliary events when they operate independently of the use case.

---

## Tail Sampling

At emission time, every wide event goes through tail sampling. The decision is pure over the event:

| Condition | Sampling rate | Rationale |
|-----------|---------------|-----------|
| `error` is present | 100% | Never lose error events |
| `durationMs > 10s` | 100% | Always capture slow executions |
| Everything else | ~5% | Representative sample for analytics |

This means:
- **Errors and SLO-breaching latency are always captured** — you can alert on them.
- **Normal operations produce a representative sample** — enough for dashboards and trend analysis.
- **Volume is predictable** — at 5% sampling, the noise floor is controlled regardless of alert volume.

The sampling function is in `packages/core/src/shared/logger/sampling.ts` and is fully deterministic over the event except for `Math.random()` on the normal path.

```typescript
export function shouldSample(event: WideEvent): boolean {
  if (event.error != null) return true;
  if (event.durationMs !== undefined && event.durationMs > SLOW_EVENT_THRESHOLD_MS) return true;
  return Math.random() < NORMAL_SAMPLE_RATE; // ~5%
}
```

---

## PII Redaction

Junando uses a **whitelist** strategy for PII redaction: only fields declared in the `WideEvent` schema survive. Any field present on the event object that is NOT in the whitelist is replaced with `[REDACTED]`.

### Rules

| Rule | Description |
|------|-------------|
| **Whitelist** | Only `SAFE_FIELDS` (the WideEvent schema) pass through |
| **String truncation** | Values longer than 1000 chars are cut and suffixed with `...[truncated]` |
| **Error stack** | Stack traces are kept ONLY in `NODE_ENV=development` — always redacted in production |
| **Deep redaction** | Nested objects inside whitelisted sections are preserved; unknown top-level keys are replaced |

### SAFE_FIELDS

```
requestId, correlationId, timestamp, component, version, outcome,
cluster, dedup, rule, llm, notify, durationMs, error
```

This is implemented in `packages/core/src/shared/logger/redaction.ts`.

---

## How to Add a Wide Event

Adding a new wide event involves these steps:

### 1. Define the Section Interface (if new)

If your stage needs new fields, add an interface in `wide-event-builder.ts`:

```typescript
export interface MyStageSection {
  someField: string;
  someMetric: number;
}
```

Add it to the `WideEvent` interface as an optional field:

```typescript
export interface WideEvent {
  // ... existing fields
  myStage?: MyStageSection;
}
```

### 2. Add to SAFE_FIELDS

In `redaction.ts`, add `'myStage'` to the `SAFE_FIELDS` set — otherwise it gets `[REDACTED]`.

### 3. Create a Builder and Write Results

```typescript
const builder = new WideEventBuilder(requestId, Component.MyStage);
builder.set('myStage', { someField: 'value', someMetric: 42 });
// ... pipeline runs ...
builder.set('outcome', outcome).set('durationMs', elapsed);

const event = builder.flush(); // applies 256 KB size guard
if (shouldSample(event)) {
  logger.info(redact(event as unknown as Record<string, unknown>));
}
```

### 4. Write Tests

- Unit test the builder with your section
- Test sampling behavior for your stage
- Test redaction preserves your whitelisted fields

---

## How to Query Wide Events (Loki)

Wide events are logged via Pino as single JSON lines. In Loki, query them with:

```logql
# Find a specific cluster by fingerprint
{service_name="junando"} | json | requestId = "abc-123:fp-456"

# All errors in the last hour
{service_name="junando"} | json | outcome = "error"

# Slow use case executions (>10s)
{service_name="junando"} | json | component = "useCase" | durationMs > 10000

# LLM latency distribution
{service_name="junando"} | json | component = "llm" | latencyMs > 0

# Dedup failures (Redis unreachable)
{service_name="junando"} | json | component = "useCase" | dedup_error = "ECONNREFUSED"

# All events for a correlation ID
{service_name="junando"} | json | correlationId = "7a1c2d3e-4f5a-4b6c-8d9e-0f1a2b3c4d5e"
```

The `service_name` label remains `"junando"` (it is a Loki stream label, not a log line field) — all wide events are filtered by `{service_name="junando"}` at the stream selector level.

For dashboards, prefer structured field queries (`| json | component = "webhook"`) over message-match patterns (`|= "webhook"`) — they are faster, more precise, and survive log message format changes.

### RUNBOOK queries

The [RUNBOOK](RUNBOOK.md) contains the full set of operational LogQL queries, all migrated to use `component` instead of the legacy `service`/`useCase` fields.

---

## Feature Flag: WIDE_EVENTS_ENABLED

The `WIDE_EVENTS_ENABLED` environment variable controls whether wide events are emitted:

| Value | Behavior |
|-------|----------|
| `true` (default) | Wide events are emitted normally with tail sampling |
| `false` | Wide events are suppressed — the pipeline runs normally but no wide event log lines are produced |

This flag is checked in `ProcessIncidentUseCase.emit()` and is set on the Lambda environment in the CDK stack (`packages/cdk/lib/junando-stack.ts`). Use it as a **rollback switch**: set it to `false` and redeploy to stop wide event emission without changing code.

**Note**: Setting `WIDE_EVENTS_ENABLED=false` does NOT restore the legacy scattered `logger.info()` calls that wide events replaced. It simply suppresses wide event emission. The pipeline logic (dedup, LLM, notifier) runs identically either way.

---

## Comparison: Wide Events vs. Scattered Logs

### Before (legacy scattered logs)

```
webhook    | service="junando" | Received 3 alerts
worker     | service="junando" | Processing batch for correlationId=abc
useCase    | service="junando" | Starting dedup
dedup      | service="junando" | Dedup result: isNew=true
useCase    | service="junando" | Fetching traces
useCase    | service="junando" | LLM request sent
useCase    | service="junando" | LLM response received, latency=2340ms
useCase    | service="junando" | Sending notification
notifier   | service="junando" | Notification sent to #alerts
useCase    | service="junando" | Pipeline complete, outcome=success
```

10 log lines. All with `service="junando"`. To trace one cluster, you need to correlate by timestamp and hope the correlationId is logged consistently. Queries are slow because every line must be pattern-matched.

### After (wide events)

```
worker  | {service_name="junando"} | correlationId="abc" component="useCase" outcome="success" durationMs=3450
        | cluster={fingerprint="fp-123", alertCount=3, spanCount=2}
        | dedup={isNew=true, ttlSeconds=300}
        | llm={provider="gemini", latencyMs=2340, urgency="HIGH", tokens=850}
        | notify={channels=["#alerts"], outcome="success", latencyMs=450}
```

1 log line. Everything about the cluster in one JSON object. Query by `correlationId` or `requestId` and get the full picture with zero joins.

---

## Testing Wide Events Locally

See `scripts/test-wide-events.sh` for a complete local test harness that:

1. Sends a test alert through the webhook
2. Checks that a wide event appears in Loki
3. Verifies the event has the expected `component`, `outcome`, and stage sections
4. Tests the `/metrics` endpoint
5. Tests `WIDE_EVENTS_ENABLED=false` suppression

For local development, Docker Compose provides Redis, Loki, Prometheus, Grafana, and Alertmanager. See the [quick start](../README.md#run-locally-5-minutes) for setup.
