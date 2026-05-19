// Public API surface for @junando/ingest
// Note: LokiHttpClient (concrete fetch impl) is NOT exported — it's an infrastructure detail.
// Users needing a custom transport should implement ILokiHttpClient.

export { IngestRunner } from './polling/ingest-runner.js';
export type { IngestRunnerDeps } from './polling/ingest-runner.js';

export { SqsSubscriber } from './polling/sqs-subscriber.js';
export type { SqsSubscriberDeps, SqsSubscriberObserver } from './polling/sqs-subscriber.js';

export { loadIngestConfig } from './config/ingest-config.schema.js';
export type {
  IngestConfig,
  IngestRule,
  LokiIngestConfig,
  LokiIngestSection,
  OpenSearchTarget,
  SqsIngestConfig,
  SqsIngestSection,
  SqsMapper,
} from './config/ingest-config.schema.js';

// Mapper registry — public API for client repos implementing IMessageMapper
export { getMapper, registerMapper } from './mappers/registry.js';
export type { IMessageMapper } from './mappers/registry.js';

export { LokiHttpError } from './ports/loki-http-client.port.js';
export type {
  ILokiHttpClient,
  LokiQueryParams,
  LokiQueryResponse,
  LokiStreamResult,
} from './ports/loki-http-client.port.js';
