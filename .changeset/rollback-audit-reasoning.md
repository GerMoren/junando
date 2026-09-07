---
"@junando/core": patch
"@junando/webhook": patch
---

Carry the LLM analysis's `probable_cause` from the Slack rollback button through to `RollbackActionRequest`, so any rollback handler can record the model's stated reasoning alongside the executed action for post-incident review. Truncated to 500 chars to stay within Slack's button-value budget; optional for backward compatibility with buttons rendered before this field existed.
