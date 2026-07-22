---
title: Wide Events
description: Junando uses wide events (canonical log lines) as its primary observability strategy.
---

Wide events (also called canonical log lines) are Junando's primary observability strategy. Every meaningful unit of work produces exactly one structured JSON line instead of scattered `logger.info()` calls.

## Philosophy

Traditional logging scatters information across many lines: one for "dedup started", one for "dedup finished", one for "LLM request sent", one for "notification delivered". Correlating these requires matching timestamps or request IDs across multiple log streams.

**Wide events invert this pattern.** Instead of logging activity, you log results:

- One line per cluster at the end of processing
- Each pipeline stage writes its result (not its activity) into a shared builder
- The final event captures the complete chain: dedup → traces → LLM → notify

## Benefits

| Concern | Scattered Logs | Wide Events |
|---|---|---|
| Query cost | N LogQL queries per trace | 1 LogQL query, filter by `requestId` |
| Missing context | Implicit — log lines are disconnected | Explicit — one event has the full chain |
| Volume | Unbounded per processing unit | Exactly 1 per unit (tail-sampled) |
| Debugging | Follow the breadcrumbs | Every answer is in one JSON object |

## Schema

```typescript
interface WideEvent {
  requestId: string;
  component: Component;
  timestamp: string;
  correlationId?: string;
  outcome?: Outcome;
  durationMs?: number;

  cluster?: ClusterSection;
  dedup?: DedupSection;
  llm?: LlmSection;
  notify?: NotifySection;
  error?: ErrorSection;
}
```

## Deep Detail

For complete documentation including the full schema, field taxonomy, tail sampling configuration, PII redaction, how to add new wide events, and LogQL query examples, see:

https://github.com/GerMoren/junando/blob/main/docs/WIDE-EVENTS.md

## Feature Flag

Wide events can be disabled via the `WIDE_EVENTS_ENABLED` environment variable. Set it to `false` and redeploy to suppress wide event emission without changing code. The pipeline logic (dedup, LLM, notifier) runs identically either way.
