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
  IngestService,
  SqsSubscriber,
  type IngestConfig,
  type IngestRunnerDeps,
  type LokiIngestConfig,
  type OpenSearchTarget,
  type SqsIngestConfig,
  type SqsSubscriberDeps,
} from "../../packages/ingest/src/index.js";
import { createDefaultOpenSearchFetcher } from "./factories/opensearch-fetcher.factory.js";
import { getMapper } from "./mappers/registry.js";
import { createTraceabilityIncidentProcessor } from "./processors/traceability-incident.processor.js";

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
  createTraceabilityIncidentProcessor?: (deps: {
    processIncidentUseCase: Pick<ProcessIncidentUseCase, "execute">;
  }) => ReturnType<typeof import("./processors/traceability-incident.processor.js").createTraceabilityIncidentProcessor>;
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

  const opensearchTarget = sqsIngestConfig.ingest.opensearch;

  if (opensearchTarget) {
    // Indexing-only path: inline indexing (no IngestService needed since
    // toTraceabilityDocument requires the raw decoded payload, not NormalizedAlert).
    const createOpenSearchIndexer =
      factories.createOpenSearchIndexer ?? defaultCreateOpenSearchIndexer;
    const indexer = createOpenSearchIndexer(opensearchTarget);
    const mapper = getMapper(sqsIngestConfig.ingest.mapper.kind);

    return createSqsSubscriber({
      config: sqsIngestConfig,
      processMessage: buildIndexerProcessor({ mapper, indexer, logger: deps.logger }),
      logger: deps.logger,
    });
  }

  // Traceability path: use IngestService for transport-agnostic processing.
  const createProcessor =
    factories.createTraceabilityIncidentProcessor ?? createTraceabilityIncidentProcessor;
  const processor = createProcessor({
    processIncidentUseCase: deps.processIncidentUseCase!,
  });
  const ingestService = new IngestService(processor);

  return createSqsSubscriber({
    config: sqsIngestConfig,
    processMessage: buildTraceabilityProcessor(
      sqsIngestConfig.ingest.mapper.kind,
      ingestService,
      deps.logger,
    ),
    logger: deps.logger,
  });
}

function buildTraceabilityProcessor(
  mapperKind: string,
  ingestService: IngestService,
  logger: Logger,
): (message: Message) => Promise<void> {
  return async (message: Message): Promise<void> => {
    const mapper = getMapper(mapperKind);
    const decoded = mapper.decode(message);
    const alerts = mapper.toNormalizedAlerts(decoded);

    for (const alert of alerts) {
      const result = await ingestService.process(alert);
      if (result.status === "error") {
        logger.error(
          { err: result.error, fingerprint: alert.fingerprint },
          "IngestService processing failed",
        );
      }
    }
  };
}

function buildIndexerProcessor(deps: {
  mapper: ReturnType<typeof getMapper>;
  indexer: Pick<IIndexer<TraceabilityDocument>, "index">;
  logger: Logger;
}): (message: Message) => Promise<void> {
  return async (message: Message): Promise<void> => {
    const decoded = deps.mapper.decode(message);
    const doc = deps.mapper.toTraceabilityDocument(decoded, message);
    await deps.indexer.index(doc);
  };
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