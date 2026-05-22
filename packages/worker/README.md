# @junando/worker

AWS Lambda SQS worker for the Junando alerting platform. Consumes messages from the SQS FIFO queue published by `@junando/webhook`, and executes the full incident processing pipeline: clustering, deduplication, trace fetching, LLM analysis, and notification dispatch.

## Installation

```bash
npm install @junando/worker
# or
pnpm add @junando/worker
```

## Usage

Deploy as an AWS Lambda function triggered by the SQS FIFO queue. The `handler` export is compatible with `SQSEvent`.

```ts
import { handler } from '@junando/worker'

export { handler }
```

## How it works

```
SQS FIFO queue
      ↓
handler (validates message schema with Zod)
      ↓
ProcessIncidentUseCase.execute()
  ├── ClusteringService     — groups alerts by root cause
  ├── RedisDeduplicationStore — skips already-processed clusters
  ├── LokiTraceRepository   — fetches relevant log traces
  ├── LLM (Claude / Gemini) — analyzes root cause
  └── Notifier (Slack / Teams) — dispatches alert
```

**Reliability characteristics:**
- Dependencies are lazily initialized on the first invocation — SSM SecureStrings are read at runtime, not module load
- Invalid message schemas are logged and skipped (no retry) to avoid infinite SQS loops
- Schema-valid but processing-failed messages re-throw so SQS retries automatically
- `flushLoki()` runs in `finally` — logs always reach Loki even if the use case throws

## Environment variables

All configuration is loaded via `@junando/core`'s `loadConfig()`, which reads from AWS SSM Parameter Store or environment variables.

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection URL for deduplication |
| `LOKI_URL` | Loki URL for trace fetching |
| `SQS_QUEUE_URL` | Source SQS queue URL |
| `LLM_PROVIDER` | `claude` or `gemini` |
| `NOTIFIER` | `slack` or `teams` |

## SQS message schema

```ts
{
  correlationId: string  // UUID
  alerts: NormalizedAlert[]
}
```

## Requirements

- Node.js >= 24
- AWS Lambda runtime triggered by SQS
- Redis (for deduplication)
- Loki (for trace fetching)
- AWS credentials (for SSM + LLM if using Claude via Bedrock)

## License

Apache-2.0
