// Domain — Entities
export * from './domain/entities/alert.js';
export * from './domain/entities/cluster.js';
export * from './domain/entities/incident.js';

// Domain — Value Objects
export { Fingerprint } from './domain/value-objects/fingerprint.js';

// Domain — Ports (interfaces)
export type {
  IAlertQueue,
  IDeduplicationStore,
  ILLMProvider,
  INotifier,
  ITraceRepository,
} from './domain/ports/index.js';

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
export {
  ClaudeProvider,
  createLLMProvider,
  GeminiProvider,
  MockLLMProvider,
} from './infrastructure/llm/llm.adapter.js';
export { ConsoleNotifier, SlackNotifier } from './infrastructure/notifier/slack.adapter.js';
export { TeamsNotifier, TeamsNotifierError } from './infrastructure/notifier/teams.adapter.js';
export { createNotifier } from './infrastructure/notifier/factory.js';
export { InMemoryAlertQueue, SQSAlertQueue } from './infrastructure/queue/sqs.adapter.js';
export {
  LokiTraceRepository,
  MockTraceRepository,
} from './infrastructure/traces/loki-trace.adapter.js';

// Shared
export { loadConfig } from './shared/config/index.js';
export type { Config } from './shared/config/index.js';
export { createLogger, reinitLogger } from './shared/logger/index.js';
export type { Logger, LoggerOptions } from './shared/logger/index.js';
export { flushLoki } from './shared/logger/loki-transport.js';
export * as metrics from './shared/metrics/index.js';
export * from './shared/constants.js';
