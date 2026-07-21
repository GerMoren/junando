---
'@junando/core': minor
'@junando/webhook': minor
'@junando/worker': minor
---

feat(observability): implement wide events / canonical log lines for all pipeline stages

Replace scattered Pino `logger.info()` calls with one canonical wide event per cluster.
Each cluster processing produces a single structured JSON line carrying the complete
pipeline chain: dedup → traces → LLM → notifier.

**WideEventBuilder** — mutable builder passed through pipeline stages; flush() produces
the final event with tail sampling and PII redaction.

**Structured adapter returns** — DedupResult, LLMResult, NotifyResult types feed the
wide event sections.

**x-correlation-id** — Webhook accepts upstream correlation ID (UUID-validated).

**/metrics endpoint** — Worker exposes prom-client registry via Function URL (IAM auth).

**Documentation** — WIDE-EVENTS.md with philosophy, taxonomy, how-to guide, and LogQL
query patterns.

Breaking: IDeduplicationStore.isNew() returns DedupResult instead of boolean.
ILLMProvider.analyze() returns LLMResult instead of LLMAnalysis.
INotifier.send() returns NotifyResult instead of void.
