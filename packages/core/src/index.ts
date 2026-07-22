// Domain — Entities
export * from './domain/entities/alert.js';
export * from './domain/entities/cluster.js';
export * from './domain/entities/incident.js';
export * from './domain/entities/rule.js';
export type { TraceabilityDocument } from './domain/entities/traceability.js';

// Domain — Value Objects
export { Fingerprint } from './domain/value-objects/fingerprint.js';

// Domain — Ports (interfaces)
export type {
  DedupResult,
  IAlertQueue,
  IDeduplicationStore,
  IIndexer,
  ILLMProvider,
  INotifier,
  IRollbackActionHandler,
  IRuleEngine,
  ITraceRepository,
  LLMResult,
  NotifyResult,
  RollbackActionRequest,
  RollbackActionResult,
  RuleActionResult,
} from './domain/ports/index.js';
export { NotifyOutcome } from './domain/ports/index.js';

// Domain — Services
export { ClusteringService } from './domain/services/clustering.service.js';

// Application
export { normalizePayload } from './application/dtos/normalize-payload.js';
export { ProcessIncidentUseCase } from './application/use-cases/process-incident.use-case.js';

// Infrastructure — Adapters (concrete implementations)
export {
  InMemoryDeduplicationStore,
  RedisDeduplicationStore,
} from './infrastructure/dedup/redis-dedup.adapter.js';
export { InMemoryIndexer, OpenSearchIndexer } from './infrastructure/indexer/opensearch.adapter.js';
export type {
  OpenSearchHttpFetcher,
  OpenSearchHttpResponse,
  OpenSearchIndexerDeps,
  SignedHttpRequest,
} from './infrastructure/indexer/opensearch.adapter.js';
export {
  ClaudeProvider,
  createLLMProvider,
  GeminiProvider,
  MockLLMProvider,
} from './infrastructure/llm/llm.adapter.js';
export { createNotifier } from './infrastructure/notifier/factory.js';
export { createRollbackActionHandler } from './infrastructure/rollback/factory.js';
export { NoopRollbackActionHandler } from './infrastructure/rollback/noop-rollback-action.handler.js';
export { ConsoleNotifier, SlackNotifier } from './infrastructure/notifier/slack.adapter.js';
export { TeamsNotifier, TeamsNotifierError } from './infrastructure/notifier/teams.adapter.js';
export { RoutingNotifier } from './infrastructure/notifier/routing-notifier.js';
export { InMemoryAlertQueue, SQSAlertQueue } from './infrastructure/queue/sqs.adapter.js';
export { startSqsLagPoller } from './infrastructure/queue/sqs-lag-poller.js';
export {
  LokiTraceRepository,
  MockTraceRepository,
} from './infrastructure/traces/loki-trace.adapter.js';

// Infrastructure — Rules Engine
export {
  parseRuleConfig,
  compileCondition,
  dispatchActions,
  ChannelRegistry,
  RuleEngine,
} from './infrastructure/rules/index.js';

// Shared
export { loadConfig } from './shared/config/index.js';
export type { Config } from './shared/config/index.js';
export * from './shared/constants.js';
export { FactoryRegistry } from './shared/factory-registry.js';
export { createLogger, reinitLogger } from './shared/logger/index.js';
export type { Logger, LoggerOptions } from './shared/logger/index.js';
export { WideEventBuilder } from './shared/logger/index.js';
export { Component, Outcome, SamplingDecision, Stage } from './shared/logger/index.js';
export { flushLoki } from './shared/logger/loki-transport.js';
export * as metrics from './shared/metrics/index.js';
