import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IngestConfig } from "../../packages/ingest/src/index.js";
import { registerMapper, type IMessageMapper } from "../ingest/mappers/registry.js";

// Import the not-yet-existing helper — RED: this will fail on module not found
import { assertMapperRegistered } from "../assert-mapper-registered.js";

// ---------------------------------------------------------------------------
// Sentinel error used to short-circuit execution when exit is called.
// ---------------------------------------------------------------------------
class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code}) called`);
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const REGISTERED_KIND = "test-registered-mapper-x1";
const UNREGISTERED_KIND = `definitely-not-registered-${crypto.randomUUID()}`;

const stubMapper: IMessageMapper = {
  kind: REGISTERED_KIND,
  decode: vi.fn(),
  toNormalizedAlerts: vi.fn().mockReturnValue([]),
  toTraceabilityDocument: vi.fn().mockReturnValue({}),
  resolveCorrelationId: vi.fn().mockReturnValue(""),
};
registerMapper(stubMapper);

function makeSqsConfig(mapperKind: string): IngestConfig {
  return {
    ingest: {
      kind: "sqs",
      sqs: {
        queueUrl: "https://sqs.us-east-1.amazonaws.com/000000000001/test-queue",
        waitTimeSeconds: 20,
        visibilityTimeoutSeconds: 60,
        batchSize: 10,
        maxInFlight: 20,
      },
      mapper: { kind: mapperKind },
    },
  } as IngestConfig;
}

function makeLokiConfig(): IngestConfig {
  return {
    ingest: {
      kind: "loki",
      intervalMs: 30_000,
      loki: { url: "http://loki:3100", timeoutMs: 10_000 },
      rules: [
        {
          name: "test-rule",
          query: '{service="api"}',
          service: "api",
          alertType: "error" as never,
          severity: "critical",
        },
      ],
    },
  } as IngestConfig;
}

function makeMockLogger() {
  return { fatal: vi.fn() };
}

function makeMockExit(): (code: number) => never {
  return (code: number): never => {
    throw new ExitCalled(code);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertMapperRegistered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SQS config + registered mapper kind", () => {
    it("does not call fatal and does not call exit", () => {
      const logger = makeMockLogger();
      const exit = vi.fn() as unknown as (code: number) => never;

      assertMapperRegistered(makeSqsConfig(REGISTERED_KIND), logger, exit);

      expect(logger.fatal).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    });
  });

  describe("SQS config + unregistered mapper kind", () => {
    it("calls logger.fatal with { mapperKind } and message matching /mapper not registered/i", () => {
      const logger = makeMockLogger();
      const exit = makeMockExit();

      expect(() => assertMapperRegistered(makeSqsConfig(UNREGISTERED_KIND), logger, exit)).toThrow(
        ExitCalled,
      );

      expect(logger.fatal).toHaveBeenCalledOnce();
      const [fields, message] = logger.fatal.mock.calls[0] as [{ mapperKind: string }, string];
      expect(fields).toMatchObject({ mapperKind: UNREGISTERED_KIND });
      expect(message).toMatch(/mapper not registered/i);
      expect(message).toContain(UNREGISTERED_KIND);
    });

    it("calls exit(1) exactly once", () => {
      const logger = makeMockLogger();
      const exitSpy = vi.fn().mockImplementation((code: number): never => {
        throw new ExitCalled(code);
      });

      expect(() =>
        assertMapperRegistered(
          makeSqsConfig(UNREGISTERED_KIND),
          logger,
          exitSpy as unknown as (code: number) => never,
        ),
      ).toThrow(ExitCalled);

      expect(exitSpy).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("does not call logger.fatal a second time after exit is called", () => {
      const logger = makeMockLogger();
      const exit = makeMockExit();

      expect(() => assertMapperRegistered(makeSqsConfig(UNREGISTERED_KIND), logger, exit)).toThrow(
        ExitCalled,
      );

      expect(logger.fatal).toHaveBeenCalledOnce();
    });
  });

  describe("Non-SQS config (loki)", () => {
    it("is a no-op — no fatal log, no exit, registry not consulted", () => {
      const logger = makeMockLogger();
      const exit = vi.fn() as unknown as (code: number) => never;

      // Even with an "unregistered" mapper kind value on a loki config, no error
      assertMapperRegistered(makeLokiConfig(), logger, exit);

      expect(logger.fatal).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    });

    it("does not throw even when using an unregistered mapper kind string in loki config", () => {
      const logger = makeMockLogger();
      const exit = makeMockExit();

      // Loki config has no mapper.kind field — helper should return without consulting registry
      expect(() => assertMapperRegistered(makeLokiConfig(), logger, exit)).not.toThrow();
    });
  });
});
