# @junando/ingest

Alert ingestion adapter for the Junando platform. Pulls alerts from external sources — Loki log queries on a schedule, or SQS queues with custom message mappers — and feeds them into the Junando processing pipeline.

## Installation

```bash
npm install @junando/ingest
# or
pnpm add @junando/ingest
```

## Modes

### 1. Loki polling

Define LogQL rules in a YAML config. `IngestRunner` evaluates each rule on an interval and forwards matching log lines as alerts.

```yaml
# ingest.config.yaml
kind: loki
loki:
  url: http://loki:3100
rules:
  - name: api-errors
    query: '{service="api"} |= "ERROR"'
    service: api
    alertType: error
    interval: 60s
```

```ts
import { IngestRunner, loadIngestConfig } from '@junando/ingest'
import { readFileSync } from 'fs'

const config = loadIngestConfig(readFileSync('ingest.config.yaml', 'utf-8'))
const runner = new IngestRunner(config, useCase)

await runner.start()

// Graceful shutdown
process.on('SIGTERM', () => runner.stop())
```

### 2. SQS subscriber with custom mappers

Register a mapper that transforms your SQS message format into `NormalizedAlert`, then subscribe to the queue.

```ts
import { SqsSubscriber, registerMapper, type IMessageMapper } from '@junando/ingest'
import type { NormalizedAlert } from '@junando/ingest'

// Implement your mapper
const cencoMapper: IMessageMapper = {
  source: 'cenco-pim',
  map(raw: unknown): NormalizedAlert[] {
    // transform raw SQS message to NormalizedAlert[]
  },
}

registerMapper(cencoMapper)

const subscriber = new SqsSubscriber({
  queueUrl: process.env.SQS_QUEUE_URL!,
  maxInFlight: 10,
  useCase,
})

await subscriber.start()
```

## Key Exports

| Export | Description |
|--------|-------------|
| `IngestRunner` | Loki polling loop with graceful drain |
| `SqsSubscriber` | SQS long-polling consumer with concurrency control |
| `loadIngestConfig()` | Parses and validates YAML config |
| `registerMapper()` | Registers a custom SQS message mapper |
| `getMapper()` | Retrieves a registered mapper by source |
| `IMessageMapper` | Interface to implement for custom mappers |
| `AlertType` | Re-exported from `@junando/core` |
| `NormalizedAlert` | Re-exported from `@junando/core` |
| `ILokiHttpClient` | Loki HTTP client port |

## Requirements

- Node.js >= 24
- Access to a Loki instance (for `IngestRunner`)
- AWS SQS queue (for `SqsSubscriber`)

## License

Apache-2.0
