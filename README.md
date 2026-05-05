# Junando

> **"Junar"** — Rioplatense lunfardo slang for *to observe / to watch closely.*

Open-source AI-powered agent for actionable observability and incident response in distributed systems.

## Architecture

```
Alertmanager webhook → Lambda A → SQS → Lambda B → Slack
                                           │
                          Domain (DDD, pure logic)
                          ├── Ports (interfaces)
                          └── Adapters (Redis, Loki, Gemini, Claude, Slack)
```

## Quick Start

```bash
git clone https://github.com/yourusername/junando.git
cd junando
corepack enable && pnpm install
cp .env.example .env.local   # fill credentials
pnpm run setup:local          # starts Docker stack
pnpm run generate:alert       # fires synthetic alert → check Slack
```

## Local URLs

| Service | URL |
|---|---|
| Grafana | http://localhost:3000 |
| Alertmanager | http://localhost:9093 |
| Prometheus | http://localhost:9090 |

## Deploy to AWS

```bash
cd packages/cdk
pnpm cdk bootstrap
pnpm cdk deploy --all
```

## License: Apache 2.0
