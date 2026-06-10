# @junando/core

## 0.11.0

### Minor Changes

- a5a409c: feat(core): add business rules engine types and ports (Phase 1 of 3).

  New domain entities: RuleCondition, RuleAction (discriminated union), Rule, RuleSection, RuleConfiguration. New IRuleEngine port with evaluatePreLlm/evaluatePostLlm methods. New RuleEvaluationPhase enum. New SeverityLevel enum. New suppressedClusters metric gauge. Closes #29.

- a5a409c: feat(core): business rules engine infrastructure (Phase 2 of 3).

  YamlRuleLoader for rules.yaml parsing and validation. ConditionEvaluator with pre-compiled predicates for 10 matchable fields. ActionDispatcher for multi-action execution. ChannelRegistry for multi-channel routing. RuleEngine implementation with first-match-wins semantics. Closes #29.

## 0.10.1

### Patch Changes

- 38423c6: refactor: replace all switch/case with maps and FactoryRegistry.

  Zero switch/case statements remaining in the codebase. Added FactoryRegistry generic class in shared/factory-registry.ts for adapter resolution. Refactored notifier factory, metric-to-alert.mapper evaluate() function, and sqs-subscriber test helpers to use map patterns instead of switch/case. Closes #137.

## 0.10.0

## 0.9.0

## 0.8.3

## 0.8.2

### Patch Changes

- f69466a: chore: validate OIDC + provenance via NPM_CONFIG_PROVENANCE env var (#110)

## 0.8.1

### Patch Changes

- 66c6701: chore: validate OIDC trusted publishing with provenance attestation (#110)

## 0.8.0
