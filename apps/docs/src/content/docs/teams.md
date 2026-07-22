---
title: Teams Integration
description: Configure Microsoft Teams notifications for Junando.
---

## Prerequisites

A Microsoft Teams workspace with permission to create Power Automate flows or incoming webhooks.

## Setup

1. In your Teams channel, click **...** > **Connectors** > **Incoming Webhook**
2. Name your webhook and create it
3. Copy the webhook URL

## Configure Junando

In your `.env` file, set:

```bash
TEAMS_WEBHOOK_URL=<TEAMS_WEBHOOK_URL>
```

For AWS deployments, store the webhook URL as an SSM SecureString parameter.

## Test

Send a test alert:

```bash
pnpm run generate:alert
```

You should receive a structured Adaptive Card in your configured Teams channel.

## Troubleshooting

- Ensure the webhook URL includes the required `api-version=` query parameter
- Verify the webhook URL is correct and has not expired
- Check the Lambda logs for `notify` stage output
