import type { Message } from "@aws-sdk/client-sqs";
import type { Logger, ProcessIncidentUseCase } from "../../packages/core/src/index.js";
import { LokiHttpClient } from "../../packages/ingest/src/adapters/loki/loki-http-client.js";
import {
  IngestRunner,
  SqsSubscriber,
  type IngestConfig,
  type IngestRunnerDeps,
  type LokiIngestConfig,
  type SqsIngestConfig,
  type SqsSubscriberDeps,
} from "../../packages/ingest/src/index.js";
import { createCencoPhaseAProcessor } from "./processors/cenco-phase-a.processor.js";

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
  createCencoPhaseAProcessor?: (deps: {
    processIncidentUseCase: Pick<ProcessIncidentUseCase, "execute">;
  }) => (message: Message) => Promise<void>;
}

export interface CreateIngestRuntimeDeps {
  ingestConfig: IngestConfig;
  processIncidentUseCase: Pick<ProcessIncidentUseCase, "execute">;
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
      processIncidentUseCase: deps.processIncidentUseCase,
      logger: deps.logger,
    });
  }

  const sqsIngestConfig = deps.ingestConfig as SqsIngestConfig;
  const createSqsSubscriber =
    factories.createSqsSubscriber ?? ((subscriberDeps) => new SqsSubscriber(subscriberDeps));
  const buildProcessor = factories.createCencoPhaseAProcessor ?? createCencoPhaseAProcessor;

  return createSqsSubscriber({
    config: sqsIngestConfig,
    processMessage: buildProcessor({
      processIncidentUseCase: deps.processIncidentUseCase,
    }),
    logger: deps.logger,
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
