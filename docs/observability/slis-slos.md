# Junando Internal SLIs and SLOs

This document defines the Service Level Indicators (SLIs) and Service Level Objectives (SLOs) that Junando measures **about itself** — how the pipeline behaves, not what it observes in your services.

Scope is intentionally narrow: four SLIs covering the critical path from alert ingestion to operator notification. They are the minimum a self-monitoring telemetry tool should be able to report about its own health.

The targets below are **initial**. Junando has no calibrated production baseline yet; numbers will move as we observe real traffic.

## What is an SLI?

A Service Level Indicator is a precise, numerical measurement of one specific user-visible behavior — usually a ratio or a latency percentile over a rolling window. It must be measurable from inside the system without external annotation.

## What is an SLO?

A Service Level Objective is the target value (and the evaluation window) that an SLI must stay within for the system to be considered healthy. SLOs are commitments, not predictions; they should be conservative enough to be defensible after an incident.

## Why these four?

Junando's critical path is: **alert in → enqueued → processed → operator notified**. Each step can fail differently:

| Step | Failure mode | SLI that catches it |
|------|--------------|---------------------|
| HTTP ingest | Slow webhook → Alertmanager retries | `ingest_latency_p99_ms` |
| Pipeline execution | Use-case throws → silent drop | `processing_success_ratio` |
| Outbound notification | Slack/Teams API fails → operator never sees the alert | `notification_success_ratio` |
| Async backpressure | Queue grows faster than workers drain → user-visible delay | `queue_lag_oldest_message_age_seconds` |

If any of these four are healthy, the corresponding failure mode is bounded. If any is unhealthy, an operator should be paged.

## SLI Definitions

### 1. Ingest Latency — `ingest_latency_p99_ms`

| Field | Value |
|-------|-------|
| **Measures** | Time from webhook receiving an HTTP request to `SQS.sendMessage()` returning OK |
| **Formula** | p99 of `junando_webhook_duration_seconds` (Prometheus histogram) |
| **Window** | 5 min rolling for paging; 30 days for SLO compliance |
| **Initial SLO** | **p99 ≤ 500 ms** (to be calibrated) |
| **Why this target** | Alertmanager retries on receiver timeout. 500 ms keeps p99 well below the default 10 s retry threshold even under contention. |

### 2. Processing Success — `processing_success_ratio`

| Field | Value |
|-------|-------|
| **Measures** | Fraction of incidents whose `ProcessIncidentUseCase.execute()` completes without throwing |
| **Formula** | `executions_ok / (executions_ok + executions_err)` |
| **Window** | 1 hour rolling for paging; 30 days for SLO compliance |
| **Initial SLO** | **≥ 99%** (to be calibrated) |
| **Why this target** | The use case has no external dependency that legitimately fails 1%+ of the time. Misses here are bugs, not noise. |

### 3. Notification Success — `notification_success_ratio`

| Field | Value |
|-------|-------|
| **Measures** | Fraction of clusters whose `notifier.send()` completes without throwing |
| **Formula** | `notify_ok / (notify_ok + notify_err)`, labeled by `channel` (slack, teams) |
| **Window** | 1 hour rolling for paging; 30 days for SLO compliance |
| **Initial SLO** | **≥ 95%** (to be calibrated) |
| **Why this target** | Slack/Teams APIs are third-party. 95% absorbs short third-party outages while still surfacing systemic problems. |

### 4. Queue Lag — `queue_lag_oldest_message_age_seconds`

| Field | Value |
|-------|-------|
| **Measures** | Age (in seconds) of the oldest unprocessed message in the SQS queue |
| **Formula** | Gauge mirrored from SQS `ApproximateAgeOfOldestMessage` |
| **Window** | Sampled every 60 s; SLO evaluated over 30 days |
| **Initial SLO** | **≤ 60 s** (to be calibrated) |
| **Why this target** | Beyond ~1 min, the operator notice is no longer "near real-time" and the value proposition of automated alerting degrades. |

## Current Instrumentation State

Reality check. Most of these are not yet wired end-to-end.

| SLI | Status | Gap |
|-----|--------|-----|
| Ingest latency | **Partial** | `junando_webhook_duration_seconds` histogram is declared in `packages/core/src/shared/metrics/index.ts` with buckets. `.observe()` is **never called** from `packages/webhook/src/handler.ts`. |
| Processing success | **None** | `alertsProcessed` counter declared, never incremented. The worker's call to `execute()` in `packages/worker/src/handler.ts` has no metric wrapper. |
| Notification success | **None** | The try/catch around `notifier.send()` in `packages/core/src/application/use-cases/process-incident.use-case.ts` only logs; no counters. |
| Queue lag | **None** | AWS exposes `ApproximateAgeOfOldestMessage` in CloudWatch but it is not bridged into the `/metrics` endpoint. |

The `/metrics` endpoint itself exists and is wired in `packages/webhook/src/handler.ts`. The Prometheus registry, `prom-client` dependency, and one working counter pattern (`webhookRequestsTotal`) are all in place. The missing work is small, mechanical, and per-SLI.

## Future Work

Each gap below is sized for a single PR. They are listed in the order an operator gets value: instrument first, dashboard later, alert last.

- [ ] **`feat(metrics): observe ingest latency in webhook handler`** (S) — Call `.observe(durationSeconds)` on the existing histogram at the end of the ingest path in `packages/webhook/src/handler.ts`. Zero new dependencies.
- [ ] **`feat(metrics): instrument processing success/failure counters in worker`** (S) — Wrap the `execute()` call in `packages/worker/src/handler.ts` with success/failure counters. Reuse the existing registry.
- [ ] **`feat(metrics): instrument notification success/failure in ProcessIncidentUseCase`** (S) — Add counters in the existing try/catch around `notifier.send()`, labeled by channel.
- [ ] **`feat(observability): expose SQS queue lag as Prometheus gauge`** (M) — Bridge `ApproximateAgeOfOldestMessage` from SQS into the `prom-client` registry. Requires a small decision on poll strategy (CloudWatch vs. direct `GetQueueAttributes`).

## Notes

- These are **internal** SLOs. They describe Junando's reliability as a tool. They are not a commitment about the services Junando observes for you.
- Targets above are starting points. Calibration requires production traffic, which we do not yet have at meaningful volume. Expect the numbers to tighten over time.
- The legacy in-memory counter module at `packages/core/src/shared/metrics/simple.ts` is superseded by the `prom-client`-based `index.ts` and should not be extended.
- Dashboards and alerting rules that consume these metrics live under `docs/dashboards/` and `docs/runbooks/`. They will be updated as each gap in **Future Work** is closed.
