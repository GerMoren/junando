import type { Message } from "@aws-sdk/client-sqs";
import { createHash } from "node:crypto";
import type { NormalizedAlert, ProcessIncidentUseCase } from "../../../packages/core/src/index.js";
import { AlertType } from "../../../packages/core/src/shared/constants.js";

interface CencoPhaseAPayload {
  uploadId?: string;
  channel: string;
  application: string;
  messageType: string;
  refId?: string;
  message: string;
  originFlow?: string;
}

export interface CencoPhaseAProcessorDeps {
  processIncidentUseCase: Pick<ProcessIncidentUseCase, "execute">;
}

export function createCencoPhaseAProcessor(deps: CencoPhaseAProcessorDeps) {
  return async (message: Message): Promise<void> => {
    const payload = decodeCencoPhaseAMessage(message);
    const alerts = mapCencoPhaseAPayloadToAlerts(payload);
    const correlationId = resolveCorrelationId(payload, message);
    await deps.processIncidentUseCase.execute(alerts, correlationId);
  };
}

export function decodeCencoPhaseAMessage(message: Message): CencoPhaseAPayload {
  if (!message.Body || message.Body.trim() === "") {
    throw new Error("Invalid Cenco Phase A message JSON: missing SQS body");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(message.Body);
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid Cenco Phase A message JSON: ${details}`);
  }

  if (!isCencoPhaseAPayload(raw)) {
    throw new Error("Invalid Cenco Phase A message payload");
  }

  return raw;
}

export function mapCencoPhaseAPayloadToAlerts(payload: CencoPhaseAPayload): NormalizedAlert[] {
  const serviceName = payload.application.trim();
  const messageType = payload.messageType.trim().toLowerCase();
  const endpointPath = payload.originFlow?.trim() ?? "";
  const channel = payload.channel.trim();
  const uploadId = payload.uploadId?.trim();
  const refId = payload.refId?.trim();

  const alert: NormalizedAlert = {
    fingerprint: computeFingerprint({
      serviceName,
      channel,
      messageType,
      endpointPath,
      message: payload.message,
      ...(uploadId ? { uploadId } : {}),
    }),
    alertName: buildAlertName(serviceName, messageType),
    status: "firing",
    serviceName,
    alertType: mapMessageTypeToAlertType(messageType),
    endpointPath,
    startsAt: new Date().toISOString(),
    labels: {
      source: "cenco-phase-a",
      channel,
      application: serviceName,
      messageType,
    },
    annotations: {
      message: payload.message,
      ...(refId ? { refId } : {}),
      ...(uploadId ? { uploadId } : {}),
    },
  };

  return [alert];
}

function resolveCorrelationId(payload: CencoPhaseAPayload, message: Message): string {
  return payload.uploadId?.trim() || message.MessageId || "generic";
}

function mapMessageTypeToAlertType(messageType: string): AlertType {
  return messageType === "warn" ? AlertType.Warning : AlertType.Error;
}

function buildAlertName(application: string, messageType: string): string {
  return `Cenco${toPascalCase(application)}${toPascalCase(messageType)}`;
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function computeFingerprint(input: {
  serviceName: string;
  channel: string;
  messageType: string;
  endpointPath: string;
  message: string;
  uploadId?: string;
}): string {
  const seed = [
    input.serviceName,
    input.channel,
    input.messageType,
    input.endpointPath,
    input.message,
    input.uploadId ?? "generic",
  ].join("|");

  return createHash("sha256").update(seed).digest("hex");
}

function isCencoPhaseAPayload(value: unknown): value is CencoPhaseAPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record["channel"] === "string" &&
    typeof record["application"] === "string" &&
    typeof record["messageType"] === "string" &&
    typeof record["message"] === "string" &&
    (record["uploadId"] === undefined || typeof record["uploadId"] === "string") &&
    (record["refId"] === undefined || typeof record["refId"] === "string") &&
    (record["originFlow"] === undefined || typeof record["originFlow"] === "string")
  );
}
