# @junando/core

## 0.14.0

### Minor Changes

- a22d10f: Adds `DynamoDBDeduplicationStore`, a store-agnostic `IDeduplicationStore` implementation backed by a
  single conditional `PutItem` (`attribute_not_exists(fingerprint) OR expiresAt < :now`), and a new
  `DEDUP_STORE` config selector (`dynamodb` — the AWS free-tier default — or `redis`). `redisUrl` is now
  optional at the schema level; the active selector's required field is enforced via `superRefine` at
  startup instead.

  This is a **minor bump, not a patch**, because the fail-open failover counter is renamed from
  `metrics.dedupRedisFailoverTotal` to `metrics.dedupFailoverTotal` now that it applies to any dedup
  store, not just Redis. Existing consumers of the Redis metric name must update to the new name.

  `DEDUP_STORE=redis` preserves the exact existing Redis dedup behaviour for the Helm chart and
  `docker/docker-compose.prod.yml` targets — no manifest changes required.

## 0.13.0

### Minor Changes

- c269950: `LLMResult.analysis` is now `LLMAnalysis | null` instead of always fabricating a diagnosis when the LLM
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

## 0.12.3

### Patch Changes

- 8ae86ac: Honour the `channel` argument in `RoutingNotifier.send`. The method previously declared only `(cluster, analysis)`, silently discarding the third parameter that `INotifier` declares and that `ProcessIncidentUseCase` passes when a rule Route action applies — so every notification went to the default notifier. It now resolves the channel against the `ChannelRegistry` and returns that notifier's `NotifyResult`, which also makes the wide event report the channel actually notified.

  Channel resolution failure and delivery failure are no longer conflated: an unregistered channel still falls back to the default, but a delivery error now propagates so the use case can mark the notification failed and let SQS retry.

  `createNotifier` also reports, at startup, any channel referenced by a rule that has no registered notifier and will therefore fall back to the default. Refs #294.

## 0.12.2

## 0.12.1

### Patch Changes

- fcc4ee4: Support `staging` as a valid runtime environment for pilot deployments.

## 0.12.0

### Minor Changes

- 6945290: feat(observability): implement wide events / canonical log lines for all pipeline stages

  Replace scattered Pino `logger.info()` calls with one canonical wide event per cluster.
  Each cluster processing produces a single structured JSON line carrying the complete
  pipeline chain: dedup → traces → LLM → notifier.

  **WideEventBuilder** — mutable builder passed through pipeline stages; flush() produces
  the final event with tail sampling and PII redaction.

  **Structured adapter returns** — DedupResult, LLMResult, NotifyResult types feed the
  wide event sections.

  **x-correlation-id** — Webhook accepts upstream correlation ID (UUID-validated).

  **/metrics endpoint** — Worker exposes prom-client registry via Function URL (IAM auth).

  **Documentation** — WIDE-EVENTS.md with philosophy, taxonomy, how-to guide, and LogQL
  query patterns.

  Breaking: IDeduplicationStore.isNew() returns DedupResult instead of boolean.
  ILLMProvider.analyze() returns LLMResult instead of LLMAnalysis.
  INotifier.send() returns NotifyResult instead of void.

## 0.11.1

### Patch Changes

- 3aaa9fd: Migrate the build pipeline from tsup to tsdown to support TypeScript 7.0.2. tsup 8.5.1 bundles rollup-plugin-dts 6.1.1, which cannot load TypeScript 7's ESM-only compiler API. tsdown uses rolldown-plugin-dts with the tsgo generator, restoring `.d.ts` emission and the full monorepo build. Refs #177.

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
