---
"@junando/core": patch
"@junando/worker": patch
---

Wire the business rules engine into the deployed worker pipeline (`RULES_CONFIG_PATH`). `createRuleEngine()` was fully built, tested and documented but never called in production — the worker now passes its result into `ProcessIncidentUseCase`, so pre-LLM suppress/route/escalate and post-LLM escalate/tag rules actually run when `RULES_CONFIG_PATH` is set. No behavior change when it's unset.
