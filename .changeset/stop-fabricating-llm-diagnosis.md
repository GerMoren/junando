---
'@junando/core': minor
---

`LLMResult.analysis` is now `LLMAnalysis | null` instead of always fabricating a diagnosis when the LLM
response could not be parsed. `parseAnalysis` no longer has a heuristic third stage that guessed
`probable_cause`, `urgency_level`, and `requires_rollback` from raw keyword matching — a genuinely
unparseable or empty response now returns `null`.

`LLMResult` (and the internal `LlmRawResult`) gains an optional `degradedReason: 'unparseable_response'
| 'empty_response'`, propagated through `resolveOutcome` (mapped to `Outcome.Degraded`) and the wide
event's `llm` section (`urgency` becomes optional, absent when there is no diagnosis). Degraded events
with no `error` section now always survive tail sampling, so this failure mode stays observable in
production.

This is a **breaking change for consumers that dereference `LLMResult.analysis` without a null check**
— hence the minor bump under 0.x. The notifier is still invoked with `analysis: null` on every parse
failure (no dropped alerts), and the Slack payload already renders the existing "manual investigation
required" fallback with no rollback action when analysis is null. Refs #292.
