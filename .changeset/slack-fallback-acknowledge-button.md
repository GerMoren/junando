---
"@junando/core": patch
---

Add the "Acknowledge" button to the Slack fallback message (sent when LLM analysis is unavailable). Acknowledging an incident doesn't depend on an AI diagnosis, so on-call teams shouldn't lose that interactivity right when the LLM degrades and manual investigation is most needed. "Trigger Rollback" is still correctly omitted in this path, since it requires the LLM's `requires_rollback` verdict.
