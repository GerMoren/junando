---
title: Pilot
description: Information about Junando pilot deployments.
---

Junando is currently available for pilot deployments in staging environments.

## Who It's For

Teams who want to evaluate Junando with real alert traffic before committing to production use. The pilot runs in an isolated staging environment alongside your existing monitoring stack.

## What's Needed

- An AWS account with permissions to deploy CDK stacks
- Access to an LLM provider (OpenRouter, Gemini, Claude)
- A Slack workspace or Teams channel for notifications
- Alertmanager or another webhook-compatible alert source

## Pilot Configuration

Deploy with isolated staging prefixes:

```bash
AWS_ENV=pilot NODE_ENV=staging SSM_PREFIX=/junando-pilot pnpm cdk deploy --all
```

## Status

The core pipeline (ingest → dedup → enrich → notify) is stable. Business rules engine (filter, route, escalate by policy) is on the roadmap.

**Note**: Issue [#155](https://github.com/GerMoren/junando/issues/155) tracks the external team setup required to close the pilot loop. An external team is needed for closure.

## Full Reference

For the complete pilot setup, readiness checklist, and acceptance procedure, see:

https://github.com/GerMoren/junando/blob/main/DEPLOY.md
