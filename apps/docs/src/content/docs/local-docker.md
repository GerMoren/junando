---
title: Local Docker
description: Run Junando locally using Docker Compose with Redis, Loki, Grafana, and Alertmanager.
---

Junando includes a Docker Compose stack for local development and testing.

## Start the Stack

From the repository root:

```bash
cp .env.example .env.local
pnpm run setup:local
```

This starts Redis, Loki, Prometheus, Alertmanager, Grafana, and OpenSearch.

## Run the Webhook

In another terminal:

```bash
pnpm run dev:webhook
```

## Send a Test Alert

```bash
pnpm run generate:alert
```

This fires a test alert through the full pipeline: webhook → queue → worker → notification.

## Verify

- Webhook health: `http://localhost:4000/health`
- Grafana: `http://localhost:3000`
- Alertmanager: `http://localhost:9093`

## Configuration

Create a `.env.local` file from `.env.example` with your credentials:

```bash
LLM_PROVIDER=openrouter
LLM_API_KEY=<YOUR_TOKEN>
SLACK_BOT_TOKEN=<YOUR_TOKEN>
SLACK_CHANNEL=#incidents
```

## Troubleshooting

| Issue                  | Fix                                      |
| ---------------------- | ---------------------------------------- |
| Port 4000 in use       | Stop other services or change the port   |
| Redis connection error | Ensure Docker is running and Redis is up |
| Missing `.env` file    | Run `cp .env.example .env.local`         |

See [Troubleshooting](/troubleshooting/) for more common issues.

## Full Docker Deployment

For a production-like local setup with Lambda emulation, see:
https://github.com/GerMoren/junando/blob/main/docker/docker-compose.prod.local.yml
