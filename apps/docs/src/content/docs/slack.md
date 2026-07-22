---
title: Slack Integration
description: Configure Slack notifications for Junando.
---

## Prerequisites

A Slack workspace where you can install apps.

## Setup

1. Create a Slack app at https://api.slack.com/apps
2. Add the `chat:write` and `chat:write.public` Bot Token Scopes
3. Install the app to your workspace
4. Copy the Bot User OAuth Token (starts with `xoxb-`)

## Configure Junando

In your `.env` file, set:

```bash
SLACK_BOT_TOKEN=<YOUR_TOKEN>
SLACK_SIGNING_SECRET=<YOUR_TOKEN>
SLACK_CHANNEL=#incidents
```

For AWS deployments, store these values as SSM SecureString parameters under `/junando/slack-bot-token`, `/junando/slack-signing-secret`, and `/junando/slack-channel`.

## Invite the Bot

Invite the Slack bot to the target channel:

```
/invite @junando
```

## Test

Send a test alert:

```bash
pnpm run generate:alert
```

You should receive a structured incident message in your configured Slack channel.

## Troubleshooting

- Ensure the bot token has the correct OAuth scopes
- Verify the bot is invited to the target channel
- Check the Lambda logs for `notify` stage output
