/**
 * worker-batch.ts
 * Pure batch processing logic — no startup side effects.
 * Exported for unit testing via worker-server.test.ts.
 */
import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { Logger } from '@junando/core';

// Minimal SQS event shape matching aws-lambda's SQSEvent
interface SQSRecord {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, unknown>;
  md5OfBody: string;
  eventSource: string;
  eventSourceARN: string;
  awsRegion: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// processBatch — pure-ish function.
// One poll cycle: receive → handle → delete on success.
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchDeps {
  sqsClient: SQSClient;
  queueUrl: string;
  handler: (event: SQSEvent) => Promise<void>;
  flushLoki: () => Promise<void>;
  logger: Logger;
}

export async function processBatch(deps: BatchDeps): Promise<void> {
  const { sqsClient, queueUrl, handler, logger } = deps;

  const receiveResult = await sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 20,
    }),
  );

  const messages = receiveResult.Messages ?? [];
  if (messages.length === 0) {
    return;
  }

  const event: SQSEvent = {
    Records: messages.map((m) => ({
      messageId: m.MessageId ?? '',
      receiptHandle: m.ReceiptHandle ?? '',
      body: m.Body ?? '',
      attributes: {} as SQSEvent['Records'][number]['attributes'],
      messageAttributes: {},
      md5OfBody: m.MD5OfBody ?? '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: '',
    })),
  };

  try {
    await handler(event);

    // Delete only after successful processing
    await sqsClient.send(
      new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: messages.map((m, i) => ({
          Id: String(i),
          ReceiptHandle: m.ReceiptHandle ?? '',
        })),
      }),
    );
  } catch (err) {
    // Do NOT delete — SQS will redeliver after visibility timeout
    logger.error({ err }, 'Handler error — messages will be redelivered');
  } finally {
    await deps.flushLoki();
  }
}
