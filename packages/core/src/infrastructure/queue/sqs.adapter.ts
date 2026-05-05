import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { IAlertQueue } from "../../domain/ports/index.js";
import type { NormalizedAlert } from "../../domain/entities/alert.js";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../shared/logger/index.js";
import { Fingerprint } from "../../domain/value-objects/fingerprint.js";

const logger = createLogger();

// ─────────────────────────────────────────────────────────────────────────────
// SQSAlertQueue — Infrastructure adapter.
// Implements IAlertQueue by publishing to AWS SQS.
// ─────────────────────────────────────────────────────────────────────────────

export class SQSAlertQueue implements IAlertQueue {
  private readonly sqs: SQSClient;

  constructor(
    private readonly queueUrl: string,
    region?: string,
  ) {
    this.sqs = new SQSClient(region ? { region } : {});
  }

  async publish(alert: NormalizedAlert): Promise<void> {
    const correlationId = randomUUID();
    const fingerprint = Fingerprint.fromAlert(alert).toString();

    try {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({ correlationId, alerts: [alert] }),
          // Group by alert fingerprint so related alerts land in the same FIFO shard
          MessageGroupId: fingerprint,
          MessageDeduplicationId: correlationId,
        }),
      );
    } catch (err) {
      logger.error(
        { err, alert: fingerprint },
        "Failed to publish alert to SQS",
      );
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// InMemoryAlertQueue — Local dev / test adapter.
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryAlertQueue implements IAlertQueue {
  readonly published: NormalizedAlert[] = [];

  async publish(alert: NormalizedAlert): Promise<void> {
    this.published.push(alert);
    const fingerprint = Fingerprint.fromAlert(alert).toString();
    logger.info(
      { alert: fingerprint },
      "Mocked publishing alert to InMemoryAlertQueue",
    );
  }
}
