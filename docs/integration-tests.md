# Integration Tests

The integration test suite verifies real infrastructure boundaries — Redis deduplication, DynamoDB deduplication, SQS publish/consume, and end-to-end `ProcessIncidentUseCase` behaviour — without mocks or real AWS credentials.

## Prerequisites

The tests require:

- **Redis** on `localhost:6379`
- **LocalStack** on `localhost:4566` with `sqs` and `dynamodb` services enabled
- The three resources below provisioned in LocalStack:
  - SQS standard queue: `junando-cenco-phase-a`
  - SQS FIFO queue: `junando-cenco-phase-a.fifo`
  - DynamoDB table: `junando-dedup` (partition key `fingerprint`, TTL attribute `expiresAt`)

## Local model (OrbStack / Docker)

Start the two Docker Compose stacks:

```bash
# Redis
docker compose -f docker/docker-compose.yml up -d redis

# LocalStack (SQS + DynamoDB)
docker compose -f docker/docker-compose.localstack.yml up -d
```

> **OrbStack users**: if your shell has `DOCKER_HOST` pointing to a missing Docker Desktop socket, prefix commands with `env -u DOCKER_HOST docker --context orbstack compose ...`

Verify both services are healthy before running the tests:

```bash
redis-cli ping                                              # should print PONG
curl -sf http://localhost:4566/_localstack/health | jq .   # sqs and dynamodb must be "running"
```

LocalStack init scripts (`docker/localstack/init/`) run automatically on first start and provision the required queues and table. If you need to re-provision without restarting the container, run the bootstrap script:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
  bash scripts/bootstrap-localstack.sh
```

The script is idempotent — safe to run multiple times.

## Running the integration tests

```bash
pnpm run test:integration
```

This uses `vitest.config.integration.ts` and only collects `*.integration.test.ts` files. It does **not** start or stop Docker services.

If a required service is unreachable, the suite aborts within 5 seconds with a clear error message naming the missing prerequisite.

Run a single test file in isolation:

```bash
pnpm run test:integration -- packages/core/src/infrastructure/dedup/__tests__/redis-dedup.adapter.integration.test.ts
```

## CI model (GitHub Actions)

The `integration` workflow (`.github/workflows/integration.yml`) runs independently from the main `CI` job. It:

1. Starts Redis and LocalStack as service containers with health checks.
2. Runs `scripts/bootstrap-localstack.sh` to provision queues and the DynamoDB table.
3. Runs `pnpm run test:integration`.

No manual setup is required. The workflow uses dummy AWS credentials (`AWS_ACCESS_KEY_ID=test`) — no real AWS account is involved.

## What is tested

| File                                          | What it verifies                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `redis-dedup.adapter.integration.test.ts`     | Real Redis rejects duplicate fingerprints and cleans up keys                     |
| `dynamodb-dedup.adapter.integration.test.ts`  | LocalStack DynamoDB rejects duplicates using the production table schema         |
| `sqs-alert-queue.adapter.integration.test.ts` | Standard-queue publish/receive and FIFO-queue publish                            |
| `process-incident.integration.test.ts`        | Full `ProcessIncidentUseCase` path: DynamoDB dedup, mock LLM, HTTP notifier stub |

## What is not tested here

- Real AWS, Bedrock, or Slack API calls
- DynamoDB in production (use the AWS pilot — issue #155)
- OpenSearch, Loki, Prometheus, Alertmanager, Grafana
- Load or performance characteristics
- Existing unit tests (those live in `vitest.config.ts`)
