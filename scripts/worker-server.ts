/**
 * worker-server.ts
 * Production SQS polling loop for the Junando worker service.
 *
 * Long-polls SQS, dispatches each batch to the worker Lambda handler,
 * deletes messages only on success, and drains on SIGTERM.
 */
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  createLogger,
  flushLoki,
  loadConfig,
  reinitLogger,
} from '@junando/core';
import { processBatch } from './worker-batch.js';

// Minimal SQS event shape
interface SQSEvent {
  Records: Array<{
    messageId: string;
    receiptHandle: string;
    body: string;
    attributes: Record<string, string>;
    messageAttributes: Record<string, unknown>;
    md5OfBody: string;
    eventSource: string;
    eventSourceARN: string;
    awsRegion: string;
  }>;
}

const logger = createLogger();

const config = await loadConfig();
reinitLogger({ level: config.logLevel });

const sqsClient = new SQSClient({});
const queueUrl = config.sqsQueueUrl ?? '';

const { handler } = (await import('../packages/worker/src/handler.js') as unknown) as {
  handler: (event: SQSEvent) => Promise<void>;
};

const POLL_INTERVAL_MS = Number(process.env['WORKER_POLL_INTERVAL_MS'] ?? 5000);

let stopping = false;
let currentBatch: Promise<void> | null = null;

const deps = {
  sqsClient,
  queueUrl,
  handler,
  flushLoki,
  logger,
};

async function poll(): Promise<void> {
  if (stopping) return;
  currentBatch = processBatch(deps);
  await currentBatch;
  currentBatch = null;
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — draining current batch');
  stopping = true;
  if (currentBatch) {
    await currentBatch;
  }
  await flushLoki();
  process.exit(0);
});

logger.info({ queueUrl, pollIntervalMs: POLL_INTERVAL_MS }, 'Worker polling started');

setInterval(() => {
  poll().catch((err) => logger.error({ err }, 'Poll error'));
}, POLL_INTERVAL_MS);

// Kick off first poll immediately
poll().catch((err) => logger.error({ err }, 'Initial poll error'));
