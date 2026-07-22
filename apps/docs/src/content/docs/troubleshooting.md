---
title: Troubleshooting
description: Common issues and solutions for Junando.
---

## Docker Port Conflicts

If services fail to start because ports are already in use:

```bash
# Check what's using the port
lsof -i :4000

# Stop conflicting services and retry
pnpm run setup:local
```

## Missing `.env` File

If you see configuration errors during local development:

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your credentials using `<YOUR_TOKEN>` placeholders.

## SQS Timeouts (Local Dev)

When running locally without LocalStack, SQS operations will time out. The pipeline uses in-process queues in development mode. Ensure `NODE_ENV` is not set to `production` when running locally.

## Redis Connection

If the worker fails to connect to Redis:

1. Verify Docker is running: `docker ps`
2. Check Redis is healthy: `docker compose ps redis`
3. Ensure `REDIS_URL` is set correctly in your `.env` file

## CDK Bootstrap

If `pnpm cdk deploy` fails with a bootstrap error:

```bash
cd packages/cdk
pnpm cdk bootstrap
```

This is a one-time operation per AWS account and region.

## Token Placeholders

Always use safe placeholders in configuration files:

| Placeholder | Usage |
|---|---|
| `<YOUR_TOKEN>` | LLM API keys, bot tokens |
| `<SLACK_WEBHOOK_URL>` | Slack webhook URLs |
| `<TEAMS_WEBHOOK_URL>` | Teams webhook URLs |

Never commit real credentials to the repository.

## Further Help

- [AWS Deployment Guide](https://github.com/GerMoren/junando/blob/main/DEPLOY.md) — full AWS deployment reference
- [Ops Runbook](https://github.com/GerMoren/junando/blob/main/docs/RUNBOOK.md) — operational procedures and recovery
- [Open an Issue](https://github.com/GerMoren/junando/issues/new)
