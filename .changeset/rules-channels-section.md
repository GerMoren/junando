---
"@junando/core": minor
---

Add a `channels:` section to the rules YAML so route/escalate actions resolve logical channel names to a concrete notifier (`type: slack` uses the shared `SLACK_BOT_TOKEN`; `type: teams` resolves its webhook URL from an env var named by `webhookUrlEnv`, never inline in the YAML). A rule referencing a channel with no matching entry now fails fast at startup instead of silently falling back to the default channel.
