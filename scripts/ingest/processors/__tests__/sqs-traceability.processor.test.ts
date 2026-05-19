import { describe, expect, it, vi } from "vitest";
import type { Message } from "@aws-sdk/client-sqs";
import type { NormalizedAlert } from "../../../../packages/core/src/domain/entities/alert.js";
import { AlertType } from "../../../../packages/core/src/shared/constants.js";
import type { IMessageMapper } from "../../mappers/registry.js";
import { createSqsTraceabilityProcessor } from "../sqs-traceability.processor.js";

function makeAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    fingerprint: "fp-123",
    alertName: "TestAlert",
    status: "firing",
    serviceName: "importer",
    alertType: AlertType.Error,
    endpointPath: "",
    startsAt: new Date().toISOString(),
    labels: {},
    annotations: {},
    ...overrides,
  };
}

function makeMapper(alerts: NormalizedAlert[] = []): IMessageMapper {
  return {
    kind: "test-mapper",
    decode: vi.fn().mockReturnValue({ uploadId: "u-1" }),
    toNormalizedAlerts: vi.fn().mockReturnValue(alerts),
    toTraceabilityDocument: vi.fn().mockReturnValue({}),
    resolveCorrelationId: vi.fn().mockReturnValue("corr-u-1"),
  };
}

function makeMessage(): Message {
  return { MessageId: "msg-1", Body: "{}" };
}

describe("createSqsTraceabilityProcessor", () => {
  it("decodes the message, maps to alerts, resolves correlationId, and calls useCase.execute", async () => {
    const alert = makeAlert();
    const mapper = makeMapper([alert]);
    const execute = vi.fn().mockResolvedValue(undefined);
    const processor = createSqsTraceabilityProcessor({
      mapper,
      processIncidentUseCase: { execute },
    });

    const msg = makeMessage();
    await processor(msg);

    expect(mapper.decode).toHaveBeenCalledWith(msg);
    const decoded = (mapper.decode as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(mapper.toNormalizedAlerts).toHaveBeenCalledWith(decoded);
    expect(mapper.resolveCorrelationId).toHaveBeenCalledWith(decoded, msg);
    expect(execute).toHaveBeenCalledWith([alert], "corr-u-1");
  });

  it("propagates useCase errors without swallowing them", async () => {
    const mapper = makeMapper([makeAlert()]);
    const execute = vi.fn().mockRejectedValue(new Error("pipeline failed"));
    const processor = createSqsTraceabilityProcessor({
      mapper,
      processIncidentUseCase: { execute },
    });

    await expect(processor(makeMessage())).rejects.toThrow(/pipeline failed/);
  });

  it("propagates mapper decode errors without calling useCase", async () => {
    const mapper: IMessageMapper = {
      kind: "test-mapper",
      decode: vi.fn().mockImplementation(() => {
        throw new Error("bad payload");
      }),
      toNormalizedAlerts: vi.fn(),
      toTraceabilityDocument: vi.fn(),
      resolveCorrelationId: vi.fn(),
    };
    const execute = vi.fn();
    const processor = createSqsTraceabilityProcessor({
      mapper,
      processIncidentUseCase: { execute },
    });

    await expect(processor(makeMessage())).rejects.toThrow(/bad payload/);
    expect(execute).not.toHaveBeenCalled();
  });
});
