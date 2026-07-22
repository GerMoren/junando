---
title: Getting Started
description: Quick overview and setup guide for Junando.
---

Junando correlates alerts from your observability stack and delivers actionable incident context directly to Slack or Teams.

## Prerequisites

- Node.js 24+
- pnpm
- Git

## Quick Setup

```bash
git clone https://github.com/GerMoren/junando.git
cd junando
corepack enable
pnpm install
pnpm build
```

## Verify

After building, you can run the full pipeline locally using Docker Compose. See the [Local Docker guide](/local-docker/) for a complete walkthrough.

## What's Next

- [Local Docker Setup](/local-docker/) — run the full stack locally
- [AWS Deployment](/aws/) — deploy to production
- [Wide Events](/wide-events/) — understand Junando's observability philosophy
