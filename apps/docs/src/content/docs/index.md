---
title: Junando Documentation
description: Documentation for Junando — alert correlation and incident context delivery.
---

Junando correlates alerts from your observability stack and delivers actionable incident context directly to Slack or Teams.

Instead of raw alerts flooding your channel at 3am, your team gets one structured message per incident with probable cause and recommended steps.

## How It Works

```
Alert sources → Webhook → Queue → Worker → Enrichment → Slack / Teams
                                               |
                                    LLM analysis + log correlation
```

1. **Ingest** — Alerts arrive via webhook (Alertmanager-compatible)
2. **Deduplicate** — Fingerprint-based clustering groups related alerts into a single incident
3. **Enrich** — LLM analysis generates probable cause and recommended steps
4. **Notify** — One structured message goes to Slack or Teams

## Quick Links

- [Getting Started](/getting-started/) — set up Junando in 5 minutes
- [Local Docker](/local-docker/) — run the full stack locally
- [AWS Deployment](/aws/) — deploy to production with CDK
- [Wide Events](/wide-events/) — canonical log line philosophy
