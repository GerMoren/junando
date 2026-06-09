---
'@junando/core': minor
---

feat(core): add business rules engine types and ports (Phase 1 of 3).

New domain entities: RuleCondition, RuleAction (discriminated union), Rule, RuleSection, RuleConfiguration. New IRuleEngine port with evaluatePreLlm/evaluatePostLlm methods. New RuleEvaluationPhase enum. New SeverityLevel enum. New suppressedClusters metric gauge. Closes #29.