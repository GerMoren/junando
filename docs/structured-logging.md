# Structured Logging Guide

Every service in Junando emits JSON logs to stdout. This guide defines the required field
schema, recommended fields, PII redaction rules, and LogQL query patterns that work against
this shape.

---

## Why structured logging

Plain-text logs cannot be queried programmatically. Structured JSON lets Loki, CloudWatch
Insights, and the `@junando/ingest` adapter filter and aggregate logs without regex parsing.
The `correlationId` field makes it possible to trace a single request across multiple
services in a single Loki query.

---

## Required fields

Every log line MUST include these four fields. The `@junando/ingest` alert rules assume they
are present.

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO 8601 string | Log emission time (e.g. `2026-05-15T12:00:00.000Z`) |
| `level` | `"debug" \| "info" \| "warn" \| "error"` | Severity of the log event |
| `service` | string | Name of the service that emitted the log (e.g. `"checkout-api"`) |
| `message` | string | Human-readable description of the event |

Example line:

```json
{
  "timestamp": "2026-05-15T12:00:00.000Z",
  "level": "error",
  "service": "checkout-api",
  "message": "Failed to charge payment method"
}
```

---

## Recommended fields

Include these fields when the information is available. They significantly improve trace
correlation and query precision.

| Field | Type | Notes |
|-------|------|-------|
| `correlationId` | string | Unique ID propagated across all service calls in a single request flow |
| `traceId` | string | Distributed trace identifier (e.g. OpenTelemetry trace ID) |
| `endpoint` | string | HTTP path that triggered the log event (e.g. `"/api/orders"`) |
| `userId` | string | **Redact or omit in production.** See the Redaction section below. |

Example line with recommended fields:

```json
{
  "timestamp": "2026-05-15T12:00:00.000Z",
  "level": "error",
  "service": "checkout-api",
  "message": "Failed to charge payment method",
  "correlationId": "abc-123",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "endpoint": "/api/checkout"
}
```

---

## PII redaction

### Never log raw user identifiers

- Do NOT log raw `userId` values, email addresses, phone numbers, session tokens, or API
  keys in production log lines.
- If you need to correlate logs to a specific user for debugging, log a one-way hash (e.g.
  SHA-256 of the userId with a secret salt) rather than the raw value.
- `correlationId` is the preferred way to trace a request — it carries no PII.

### Redaction checklist before shipping a new log statement

1. Does the `message` or any field contain a user identifier, email, or phone number?
   If yes, replace it with a hash or omit it.
2. Does any field contain an auth token, API key, or password? Never log these.
3. Does the `endpoint` path contain an inline user ID (e.g. `/users/42/profile`)?
   If yes, redact the segment: `/users/[redacted]/profile`.

---

## LogQL example queries

These queries assume logs are indexed in Loki with the JSON parser. All examples reference
fields from the required and recommended field sets above.

### 1. Error count by service over 5 minutes

Fires when the `checkout-api` service logs more than 10 errors in a 5-minute window.

```logql
count_over_time({service="checkout-api"} |= "\"level\":\"error\"" [5m]) > 10
```

### 2. Trace a request by correlationId

Returns all log lines across any service that share a given correlation ID.

```logql
{service="checkout-api"} | json | correlationId="abc-123"
```

### 3. Error rate on a specific endpoint

Measures the per-second rate of error-level logs on `/api/orders` over a 5-minute window.

```logql
rate({service="checkout-api"} | json | endpoint="/api/orders" | level="error" [5m])
```

---

## Adopting in your service

Junando uses [Pino](https://getpino.io) as the logger. To get a pre-configured instance
that emits the required schema:

```ts
import { createLogger } from '@junando/core';

const logger = createLogger({ service: 'my-service' });

logger.info({ correlationId: req.headers['x-correlation-id'], endpoint: req.path }, 'Request received');
```

`createLogger` sets `timestamp`, `level`, and `service` automatically on every line.
You only need to provide `correlationId`, `endpoint`, and any other context-specific fields
at the call site.
