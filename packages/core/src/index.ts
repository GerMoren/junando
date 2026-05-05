// Domain — Entities
export * from "./domain/entities/alert.js";
export * from "./domain/entities/cluster.js";
export * from "./domain/entities/incident.js";

// Domain — Value Objects
export { Fingerprint } from "./domain/value-objects/fingerprint.js";

// Domain — Ports (interfaces)
export type {
  IDeduplicationStore,
  IAlertQueue,
  ITraceRepository,
  ILLMProvider,
  INotifier,
} from "./domain/ports/index.js";

// Domain — Services
export { ClusteringService } from "./domain/services/clustering.service.js";

// Application
export { ProcessIncidentUseCase } from "./application/use-cases/process-incident.use-case.js";
export { normalizePayload } from "./application/dtos/normalize-payload.js";

// Infrastructure — Adapters (concrete implementations)
export {
  RedisDeduplicationStore,
  InMemoryDeduplicationStore,
} from "./infrastructure/dedup/redis-dedup.adapter.js";
export {
  LokiTraceRepository,
  MockTraceRepository,
} from "./infrastructure/traces/loki-trace.adapter.js";
export {
  GeminiProvider,
  ClaudeProvider,
  MockLLMProvider,
  createLLMProvider,
} from "./infrastructure/llm/llm.adapter.js";
export {
  SlackNotifier,
  ConsoleNotifier,
} from "./infrastructure/notifier/slack.adapter.js";
export {
  SQSAlertQueue,
  InMemoryAlertQueue,
} from "./infrastructure/queue/sqs.adapter.js";

// Shared
export { createLogger } from "./shared/logger/index.js";
export { loadConfig } from "./shared/config/index.js";
export type { Config } from "./shared/config/index.js";
export type { Logger } from "./shared/logger/index.js";
