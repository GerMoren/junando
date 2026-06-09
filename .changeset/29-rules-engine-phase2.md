---
'@junando/core': minor
---

feat(core): business rules engine infrastructure (Phase 2 of 3).

YamlRuleLoader for rules.yaml parsing and validation. ConditionEvaluator with pre-compiled predicates for 10 matchable fields. ActionDispatcher for multi-action execution. ChannelRegistry for multi-channel routing. RuleEngine implementation with first-match-wins semantics. Closes #29.