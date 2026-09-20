---
"@junando/core": minor
---

Add an optional two-stage triage step, off by default. When enabled (`TRIAGE_ENABLED=true`, `TRIAGE_PROVIDER=vercel-gateway`, `TRIAGE_MODEL`, `TRIAGE_API_KEY`), a cheap classification call scores each incident's severity before the full LLM analysis. Low-severity incidents skip the expensive LLM call and are notified with the standard no-diagnosis fallback message instead, saving cost on noise. Fail-open by design: any triage failure (network error, bad response, unparseable content) proceeds to the full analysis exactly as if triage were disabled — it never suppresses a real incident.

With `TRIAGE_ENABLED` unset or `false` (the default), pipeline behavior is unchanged.
