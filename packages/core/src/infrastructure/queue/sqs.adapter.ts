import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { IAlertQueue } from '../../domain/ports/index.js';
import type { NormalizedAlert } from '../../domain/entities/alert.js';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../shared/logger/index.js';
import { Fingerprint } from '../../domain/value-objects/fingerprint.js';

const logger = createLogger();

// ─────────────────────────────────────────────────────────────────────────────
// SQSAlertQueue — Infrastructure adapter.
// Implements IAlertQueue by publishing to AWS SQS.
// SQSClient is initialized lazily (singleton) on first use to avoid
// module-level AWS credential errors in local dev.
// ─────────────────────────────────────────────────────────────────────────────

export interface SendMessageParams {
  messageBody: string;
  messageGroupId: string;
  messageDeduplicationId: string;
}

export class SQSAlertQueue implements IAlertQueue {
  private sqsClient: SQSClient | null = null;

  constructor(
    private readonly queueUrl: string,
    private readonly region?: string,
  ) {}

  private getClient(): SQSClient {
    if (!this.sqsClient) {
      this.sqsClient = new SQSClient(this.region ? { region: this.region } : {});
    }
    return this.sqsClient;
  }

  async sendMessage(params: SendMessageParams): Promise<void> {
    await this.getClient().send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: params.messageBody,
        MessageGroupId: params.messageGroupId,
        MessageDeduplicationId: params.messageDeduplicationId,
      }),
    );
  }

  async publish(alert: NormalizedAlert): Promise<void> {
    const correlationId = randomUUID();
    const fingerprint = Fingerprint.fromAlert(alert).toString();

    try {
      await this.sendMessage({
        messageBody: JSON.stringify({ correlationId, alerts: [alert] }),
        messageGroupId: fingerprint,
        messageDeduplicationId: correlationId,
      });
    } catch (err) {
      logger.error({ err, alert: fingerprint }, 'Failed to publish alert to SQS');
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
    logger.info({ alert: fingerprint }, 'Mocked publishing alert to InMemoryAlertQueue');
  }
}
