import { describe, expect, it, vi } from "vitest";
import type { Message } from "@aws-sdk/client-sqs";
import { createSamplePhaseAProcessor } from "../sample-phase-a.processor.js";

function makeMessage(body: unknown, overrides: Partial<Message> = {}): Message {
  return {
    MessageId: "msg-123",
    ReceiptHandle: "receipt-123",
    Body: JSON.stringify(body),
    ...overrides,
  };
}

describe("createSamplePhaseAProcessor", () => {
  it("decodes a Sample message, maps it to alerts, and calls ProcessIncidentUseCase.execute", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const processMessage = createSamplePhaseAProcessor({
      processIncidentUseCase: { execute },
    });

    await processMessage(
      makeMessage({
        uploadId: "upload-abc",
        channel: "easy",
        application: "importer",
        messageType: "error",
        refId: "ref-77",
        message: "Product import failed",
        originFlow: "catalog-sync",
      }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const [alerts, correlationId] = execute.mock.calls[0] ?? [];

    expect(correlationId).toBe("upload-abc");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      alertName: "SampleImporterError",
      status: "firing",
      serviceName: "importer",
      alertType: "http_500",
      endpointPath: "catalog-sync",
      labels: {
        source: "sample-phase-a",
        channel: "easy",
        application: "importer",
        messageType: "error",
      },
      annotations: {
        message: "Product import failed",
        refId: "ref-77",
        uploadId: "upload-abc",
      },
    });
    expect(typeof alerts[0]?.fingerprint).toBe("string");
    expect(alerts[0]?.fingerprint.length).toBeGreaterThan(10);
    expect(alerts[0]?.startsAt).toMatch(/T.*Z$/);
  });

  it("throws when the SQS body is malformed JSON", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const processMessage = createSamplePhaseAProcessor({
      processIncidentUseCase: { execute },
    });

    await expect(
      processMessage({ MessageId: "bad-json", Body: "{not-json" } as Message),
    ).rejects.toThrow(/invalid sample phase a message json/i);

    expect(execute).not.toHaveBeenCalled();
  });

  it("throws when the SQS body is empty or whitespace", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const processMessage = createSamplePhaseAProcessor({
      processIncidentUseCase: { execute },
    });

    await expect(processMessage({ MessageId: "blank", Body: "   " } as Message)).rejects.toThrow(
      /missing sqs body/i,
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it("throws when the parsed JSON does not match the expected Sample payload shape", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const processMessage = createSamplePhaseAProcessor({
      processIncidentUseCase: { execute },
    });

    await expect(
      processMessage(
        makeMessage({
          channel: 42,
          application: "importer",
          messageType: "error",
          message: "broken payload",
        }),
      ),
    ).rejects.toThrow(/invalid sample phase a message payload/i);

    expect(execute).not.toHaveBeenCalled();
  });

  it("falls back to SQS MessageId when uploadId is missing", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const processMessage = createSamplePhaseAProcessor({
      processIncidentUseCase: { execute },
    });

    await processMessage(
      makeMessage(
        {
          channel: "paris",
          application: "pim",
          messageType: "warn",
          message: "Variant price drift detected",
        },
        { MessageId: "sqs-msg-999" },
      ),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const [alerts, correlationId] = execute.mock.calls[0] ?? [];

    expect(correlationId).toBe("sqs-msg-999");
    expect(alerts[0]).toMatchObject({
      alertName: "SamplePimWarn",
      serviceName: "pim",
      alertType: "latency_spike",
      endpointPath: "",
      labels: {
        source: "sample-phase-a",
        channel: "paris",
        application: "pim",
        messageType: "warn",
      },
      annotations: {
        message: "Variant price drift detected",
      },
    });
  });

  it('falls back to "generic" when both uploadId and MessageId are missing', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const processMessage = createSamplePhaseAProcessor({
      processIncidentUseCase: { execute },
    });

    await processMessage(
      makeMessage(
        {
          uploadId: "   ",
          channel: "easy",
          application: "importer",
          messageType: "error",
          message: "No upload id on payload",
        },
        { MessageId: undefined },
      ),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const [, correlationId] = execute.mock.calls[0] ?? [];
    expect(correlationId).toBe("generic");
  });
});
