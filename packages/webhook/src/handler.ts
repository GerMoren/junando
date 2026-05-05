import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  AlertmanagerPayloadSchema,
  normalizePayload,
  createLogger,
} from "@junando/core";
import { randomUUID } from "node:crypto";

const logger = createLogger();

// ─────────────────────────────────────────────────────────────────────────────
// Lambda A — Webhook Receiver
// Receives Alertmanager webhook → validates → publishes to SQS → 200 in <50ms
// No business logic here. Just boundary validation and enqueue.
// ─────────────────────────────────────────────────────────────────────────────

const sqs = new SQSClient({});
const QUEUE_URL = process.env["SQS_QUEUE_URL"] ?? "";

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const correlationId = randomUUID();

  // Health check
  if (event.rawPath === "/health") {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: "ok", service: "junando-webhook" }),
    };
  }

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: "Empty body" }) };
  }

  // Parse and validate at the boundary
  let raw: unknown;
  try {
    raw = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const parsed = AlertmanagerPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      statusCode: 422,
      body: JSON.stringify({
        error: "Invalid payload",
        issues: parsed.error.issues,
      }),
    };
  }

  // Normalize to domain entities
  const alerts = normalizePayload(parsed.data);
  if (alerts.length === 0) {
    // All resolved — nothing to process
    return { statusCode: 200, body: JSON.stringify({ accepted: 0 }) };
  }

  // Publish to SQS — this is the only AWS call in Lambda A
  if (QUEUE_URL) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({ correlationId, alerts }),
        MessageGroupId: parsed.data.groupKey, // FIFO queue support
        MessageDeduplicationId: correlationId,
      }),
    );
  } else {
    logger.info(
      { alerts },
      `[LOCAL DEV] Webhook received ${alerts.length} alerts. Bypassing SQS publish.`,
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ accepted: alerts.length, correlationId }),
  };
};
