---
'@junando/ingest': minor
---

Add transport-agnostic `IngestService` entry point for processing already-normalized alerts. The new `IngestService` class accepts an injected `IncidentProcessor` and exposes `process(alert, options?)` with configurable pipeline stages (`enableLlmAnalysis`, `enableNotifications`, `enableTraceabilityIndexing`). This decouples `@junando/ingest` from `@junando/core` and allows Junando to run on any transport (SQS, HTTP, cron) without mandating SNS/SQS topology. Closes #127.