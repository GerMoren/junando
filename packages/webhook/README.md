# @junando/webhook

AWS Lambda handler for the Junando alerting platform. Receives Alertmanager webhooks and Slack interactivity payloads, validates them at the boundary, and publishes to SQS FIFO for async processing. Designed to respond in < 50ms with no business logic.

## Installation

```bash
npm install @junando/webhook
# or
pnpm add @junando/webhook
```

## Usage

Deploy as an AWS Lambda function. The `handler` export is compatible with `APIGatewayProxyEventV2`.

```ts
import { handler } from '@junando/webhook'

export { handler }
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{ status: 'ok' }` |
| `GET` | `/metrics` | Prometheus metrics in text format |
| `POST` | `/` | Alertmanager webhook — validates with Zod, publishes to SQS FIFO |
| `POST` | `/webhook/slack-interactivity` | Slack actions — verifies HMAC-SHA256 with 5-min replay protection |

## Environment variables

| Variable | Description |
|----------|-------------|
| `SQS_QUEUE_URL` | SQS FIFO queue URL to publish alerts |
| `SLACK_SIGNING_SECRET` | Secret for HMAC verification of Slack payloads |

> **Local dev**: if `SQS_QUEUE_URL` is not set, the webhook runs `ProcessIncidentUseCase` inline (dynamic import to avoid cold start penalty in AWS).

## Requirements

- Node.js >= 24
- AWS Lambda runtime
- SQS FIFO queue

## License

Apache-2.0
