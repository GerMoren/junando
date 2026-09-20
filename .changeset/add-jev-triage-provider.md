---
"@junando/core": minor
---

Add `JevTriageProvider` — a real triage backend using TypeSafe AI's Jev via Vercel AI Gateway's Evaluation API (`POST /v1/evaluate`), a purpose-built decision/scoring model rather than a chat-completions LLM. Set `TRIAGE_PROVIDER=jev` (no `TRIAGE_MODEL` needed). Confirmed live against real alert clusters: fast (~150-400ms), accurate, and — while Jev remains in its promotional window — free. This unblocks the "jev" backend originally scoped in issue #355 and deferred pending Vercel documenting the correct integration path (Jev is rejected on the standard chat-completions endpoint).
