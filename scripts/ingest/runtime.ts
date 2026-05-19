// NOTE: No client-specific mapper is imported here.
// Each deployment must register its own IMessageMapper before this module runs.
// See scripts/ingest/mappers/registry.ts for the interface and scripts/ingest/mappers/MAPPER_GUIDE.md for how to implement one.

import type { Message } from "@aws-sdk/client-sqs";
import type {
  IIndexer,
  Logger,
  ProcessIncidentUseCase,
  TraceabilityDocument,
} from "../../packages/core/src/index.js";
import { OpenSearchIndexer } from "../../packages/core/src/index.js";
import { LokiHttpClient } from "../../packages/ingest/src/adapters/loki/loki-http-client.js";
import {
  IngestRunner,
  SqsSubscriber,
  type IngestConfig,
  type IngestRunnerDeps,
  type LokiIngestConfig,
  type OpenSearchTarget,
  type SqsIngestConfig,
  type SqsSubscriberDeps,
} from "../../packages/ingest/src/index.js";
import { createDefaultOpenSearchFetcher } from "./factories/opensearch-fetcher.factory.js";
import type { IMessageMapper } from "./mappers/registry.js";
import { getMapper } from "./mappers/registry.js";
import { createSqsIndexerProcessor } from "./processors/sqs-indexer.processor.js";
import { createSqsTraceabilityProcessor } from "./processors/sqs-traceability.processor.js";

export interface ManagedIngestRuntime {
  start(): void;
  stop(): Promise<void>;
}

interface RuntimeFactories {
  createLokiClient?: (deps: {
    ingestConfig: Extract<IngestConfig, { ingest: { kind: "loki" } }>;
  }) => IngestRunnerDeps["lokiClient"];
  createLokiRunner?: (deps: IngestRunnerDeps) => ManagedIngestRuntime;
  createSqsSubscriber?: (deps: SqsSubscriberDeps) => ManagedIngestRuntime;
  createSqsTraceabilityProcessor?: (deps: {
    mapper: IMessageMapper;
    processIncidentUseCase: Pick<ProcessIncidentUseCase, "execute">;
  }) => (message: Message) => Promise<void>;
  createSqsIndexerProcessor?: (deps: {
    mapper: IMessageMapper;
    indexer: Pick<IIndexer<TraceabilityDocument>, "index">;
  }) => (message: Message) => Promise<void>;
  createOpenSearchIndexer?: (
    target: OpenSearchTarget,
  ) => Pick<IIndexer<TraceabilityDocument>, "index">;
}

export interface CreateIngestRuntimeDeps {
  ingestConfig: IngestConfig;
  processIncidentUseCase?: Pick<ProcessIncidentUseCase, "execute">;
  logger: Logger;
  factories?: RuntimeFactories;
}

export function createIngestRuntime(deps: CreateIngestRuntimeDeps): ManagedIngestRuntime {
  const factories = deps.factories ?? {};

  if (deps.ingestConfig.ingest.kind === "loki") {
    const lokiIngestConfig = deps.ingestConfig as LokiIngestConfig;
    const createLokiClient = factories.createLokiClient ?? defaultCreateLokiClient;
    const createLokiRunner =
      factories.createLokiRunner ?? ((runnerDeps) => new IngestRunner(runnerDeps));

    return createLokiRunner({
      config: lokiIngestConfig,
      lokiClient: createLokiClient({ ingestConfig: lokiIngestConfig }),
      processIncidentUseCase: deps.processIncidentUseCase!,
      logger: deps.logger,
    });
  }

  const sqsIngestConfig = deps.ingestConfig as SqsIngestConfig;
  const createSqsSubscriber =
    factories.createSqsSubscriber ?? ((subscriberDeps) => new SqsSubscriber(subscriberDeps));

  const processMessage = buildSqsProcessor(sqsIngestConfig, deps, factories);

  return createSqsSubscriber({
    config: sqsIngestConfig,
    processMessage,
    logger: deps.logger,
  });
}

function buildSqsProcessor(
  sqsIngestConfig: SqsIngestConfig,
  deps: CreateIngestRuntimeDeps,
  factories: RuntimeFactories,
): (message: Message) => Promise<void> {
  const mapper = getMapper(sqsIngestConfig.ingest.mapper.kind);

  const opensearchTarget = sqsIngestConfig.ingest.opensearch;
  if (opensearchTarget) {
    const createOpenSearchIndexer =
      factories.createOpenSearchIndexer ?? defaultCreateOpenSearchIndexer;
    const buildIndexerProcessor = factories.createSqsIndexerProcessor ?? createSqsIndexerProcessor;

    return buildIndexerProcessor({
      mapper,
      indexer: createOpenSearchIndexer(opensearchTarget),
    });
  }

  const buildTraceabilityProcessor =
    factories.createSqsTraceabilityProcessor ?? createSqsTraceabilityProcessor;
  return buildTraceabilityProcessor({
    mapper,
    processIncidentUseCase: deps.processIncidentUseCase!,
  });
}

function defaultCreateLokiClient(deps: {
  ingestConfig: Extract<IngestConfig, { ingest: { kind: "loki" } }>;
}): IngestRunnerDeps["lokiClient"] {
  const lokiAuth = deps.ingestConfig.ingest.loki.auth;
  return new LokiHttpClient({
    baseUrl: deps.ingestConfig.ingest.loki.url,
    timeoutMs: deps.ingestConfig.ingest.loki.timeoutMs,
    ...(lokiAuth === undefined ? {} : { auth: lokiAuth }),
  });
}

function defaultCreateOpenSearchIndexer(target: OpenSearchTarget): OpenSearchIndexer {
  return new OpenSearchIndexer({
    endpoint: target.endpoint,
    indexName: target.indexName,
    region: target.region,
    fetcher: createDefaultOpenSearchFetcher({ region: target.region }),
  });
}
