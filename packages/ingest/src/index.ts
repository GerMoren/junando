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
  SqsIngestConfig,
  SqsIngestSection,
} from './config/ingest-config.schema.js';

export type {
  ILokiHttpClient,
  LokiQueryParams,
  LokiQueryResponse,
  LokiStreamResult,
} from './ports/loki-http-client.port.js';
export { LokiHttpError } from './ports/loki-http-client.port.js';
