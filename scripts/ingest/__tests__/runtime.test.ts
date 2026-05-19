import { describe, expect, it, vi } from "vitest";
import type { Message } from "@aws-sdk/client-sqs";
import type { Logger, ProcessIncidentUseCase } from "../../../packages/core/src/index.js";
import type {
  IngestConfig,
  LokiIngestConfig,
  SqsIngestConfig,
} from "../../../packages/ingest/src/index.js";
import { createIngestRuntime } from "../runtime.js";
import { AlertType } from "../../../packages/core/src/index.js";
import { registerMapper, type IMessageMapper } from "../mappers/registry.js";

// Register a stub mapper for the kind used in test configs.
// In production each deployment registers its own mapper before runtime starts.
const stubMapper: IMessageMapper = {
  kind: "test-mapper-v1",
  decode: vi.fn().mockReturnValue({}),
  toNormalizedAlerts: vi.fn().mockReturnValue([]),
  toTraceabilityDocument: vi
    .fn()
    .mockReturnValue({
      "@timestamp": "",
      channel: "",
      application: "",
      messageType: "",
      message: "",
      fingerprint: "",
      correlationId: "",
    }),
  resolveCorrelationId: vi.fn().mockReturnValue("test-corr-id"),
};
registerMapper(stubMapper);

function makeLogger(): Logger {
  return {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeLokiConfig(): LokiIngestConfig {
  return {
    ingest: {
      kind: "loki",
      intervalMs: 30_000,
      loki: { url: "http://loki:3100", timeoutMs: 10_000 },
      rules: [
        {
          name: "high-error-rate",
          query: '{service="api"} |= "ERROR"',
          service: "api",
          alertType: AlertType.Error,
          severity: "critical",
        },
      ],
    },
  };
}

function makeSqsConfig(): SqsIngestConfig {
  return {
    ingest: {
      kind: "sqs",
      sqs: {
        queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors",
        waitTimeSeconds: 20,
        visibilityTimeoutSeconds: 60,
        batchSize: 10,
        maxInFlight: 20,
      },
      mapper: { kind: "test-mapper-v1" },
    },
  };
}

describe("createIngestRuntime", () => {
  it("selects the Loki runtime when kind=loki", () => {
    const logger = makeLogger();
    const useCase = { execute: vi.fn() } as unknown as Pick<ProcessIncidentUseCase, "execute">;
    const lokiRuntime = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
    const createLokiClient = vi.fn().mockReturnValue({ queryRange: vi.fn() });
    const createLokiRunner = vi.fn().mockReturnValue(lokiRuntime);
    const createSqsSubscriber = vi.fn();
    const createSqsTraceabilityProcessor = vi.fn();

    const runtime = createIngestRuntime({
      ingestConfig: makeLokiConfig(),
      processIncidentUseCase: useCase,
      logger,
      factories: {
        createLokiClient,
        createLokiRunner,
        createSqsSubscriber,
        createSqsTraceabilityProcessor,
      },
    });

    expect(runtime).toBe(lokiRuntime);
    expect(createLokiClient).toHaveBeenCalledTimes(1);
    expect(createLokiRunner).toHaveBeenCalledTimes(1);
    expect(createSqsSubscriber).not.toHaveBeenCalled();
    expect(createSqsTraceabilityProcessor).not.toHaveBeenCalled();
  });

  it("selects the SQS runtime and wires the traceability processor when kind=sqs (no opensearch)", async () => {
    const logger = makeLogger();
    const useCase = { execute: vi.fn() } as unknown as Pick<ProcessIncidentUseCase, "execute">;
    const sqsRuntime = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
    const createSqsSubscriber = vi.fn().mockReturnValue(sqsRuntime);
    const processMessage = vi.fn().mockResolvedValue(undefined);
    const createSqsTraceabilityProcessor = vi.fn().mockReturnValue(processMessage);

    const runtime = createIngestRuntime({
      ingestConfig: makeSqsConfig(),
      processIncidentUseCase: useCase,
      logger,
      factories: {
        createLokiClient: vi.fn(),
        createLokiRunner: vi.fn(),
        createSqsSubscriber,
        createSqsTraceabilityProcessor,
      },
    });

    expect(runtime).toBe(sqsRuntime);
    expect(createSqsTraceabilityProcessor).toHaveBeenCalledWith(
      expect.objectContaining({
        processIncidentUseCase: useCase,
        mapper: expect.objectContaining({ kind: "test-mapper-v1" }),
      }),
    );
    expect(createSqsSubscriber).toHaveBeenCalledTimes(1);

    const deps = createSqsSubscriber.mock.calls[0]?.[0] as {
      config: IngestConfig;
      processMessage: (message: Message) => Promise<void>;
      logger: Logger;
    };

    expect(deps.config).toEqual(makeSqsConfig());
    expect(deps.logger).toBe(logger);
    await deps.processMessage({ MessageId: "msg-1", Body: "{}" });
    expect(processMessage).toHaveBeenCalledTimes(1);
  });

  it("wires the indexer processor when sqs config has an opensearch block", async () => {
    const logger = makeLogger();
    const useCase = { execute: vi.fn() } as unknown as Pick<ProcessIncidentUseCase, "execute">;
    const sqsRuntime = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) };
    const createSqsSubscriber = vi.fn().mockReturnValue(sqsRuntime);
    const processMessage = vi.fn().mockResolvedValue(undefined);
    const createSqsIndexerProcessor = vi.fn().mockReturnValue(processMessage);
    const createSqsTraceabilityProcessor = vi.fn();
    const indexer = { index: vi.fn().mockResolvedValue(undefined) };
    const createOpenSearchIndexer = vi.fn().mockReturnValue(indexer);

    const sqsConfig: SqsIngestConfig = {
      ingest: {
        ...makeSqsConfig().ingest,
        opensearch: {
          endpoint: "https://search.example.com",
          indexName: "traceability",
          region: "us-east-1",
        },
      },
    };

    const runtime = createIngestRuntime({
      ingestConfig: sqsConfig,
      processIncidentUseCase: useCase,
      logger,
      factories: {
        createLokiClient: vi.fn(),
        createLokiRunner: vi.fn(),
        createSqsSubscriber,
        createSqsTraceabilityProcessor,
        createSqsIndexerProcessor,
        createOpenSearchIndexer,
      },
    });

    expect(runtime).toBe(sqsRuntime);
    expect(createOpenSearchIndexer).toHaveBeenCalledWith({
      endpoint: "https://search.example.com",
      indexName: "traceability",
      region: "us-east-1",
    });
    expect(createSqsIndexerProcessor).toHaveBeenCalledWith(
      expect.objectContaining({
        indexer,
        mapper: expect.objectContaining({ kind: "test-mapper-v1" }),
      }),
    );
    expect(createSqsTraceabilityProcessor).not.toHaveBeenCalled();
    expect(createSqsSubscriber).toHaveBeenCalledTimes(1);
  });
});
