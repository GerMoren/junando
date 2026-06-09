---
'@junando/worker': minor
---

feat(worker): add CSV input adapter for SQS messages from external monitoring tools.

The adapter auto-detects CSV bodies in SQS messages and parses them into `NormalizedAlert[]` using configurable column mapping via env vars (`CSV_SERVICE_COL`, `CSV_MESSAGE_COL`, `CSV_SEVERITY_COL`, `CSV_TIMESTAMP_COL`, `CSV_FINGERPRINT_COL`, `CSV_ENDPOINT_COL`, `CSV_EXTRA_LABELS`). Falls back to JSON when the body is not valid CSV. Closes #20.