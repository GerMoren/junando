import { randomUUID } from 'node:crypto';
import { GetQueueUrlCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SQSAlertQueue } from '../sqs.adapter.js';

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
const REGION = 'us-east-1';
const STANDARD_QUEUE_NAME = 'junando-cenco-phase-a';
const FIFO_QUEUE_NAME = 'junando-cenco-phase-a.fifo';
const client = new SQSClient({
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
});
let standardQueueUrl: string;
let fifoQueueUrl: string;

beforeAll(async () => {
  process.env['AWS_ACCESS_KEY_ID'] = 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
  process.env['AWS_DEFAULT_REGION'] = REGION;
  process.env['AWS_ENDPOINT_URL'] = LOCALSTACK_ENDPOINT;

  try {
    const [standard, fifo] = await Promise.all([
      client.send(new GetQueueUrlCommand({ QueueName: STANDARD_QUEUE_NAME })),
      client.send(new GetQueueUrlCommand({ QueueName: FIFO_QUEUE_NAME })),
    ]);
    if (!standard.QueueUrl || !fifo.QueueUrl)
      throw new Error('Integration queues are not provisioned');
    standardQueueUrl = standard.QueueUrl;
    fifoQueueUrl = fifo.QueueUrl;
  } catch (error) {
    throw new Error(`LocalStack SQS is required at ${LOCALSTACK_ENDPOINT}: ${String(error)}`);
  }
});

describe('SQSAlertQueue integration', () => {
  it('publishes and receives a message through the standard queue', async () => {
    const correlationId = randomUUID();
    const messageBody = JSON.stringify({ id: correlationId, kind: 'standard' });
    const queue = new SQSAlertQueue(standardQueueUrl, REGION);

    await queue.sendMessage({
      messageBody,
      messageDeduplicationId: randomUUID(),
      messageGroupId: 'integration-test',
    });

    // Poll to find our specific message; stale messages from prior runs may be ahead.
    let found = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const received = await client.send(
        new ReceiveMessageCommand({
          MaxNumberOfMessages: 10,
          QueueUrl: standardQueueUrl,
          WaitTimeSeconds: 2,
        }),
      );
      if (received.Messages?.some((m) => m.Body?.includes(correlationId))) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('publishes to the FIFO queue with FIFO parameters', async () => {
    const queue = new SQSAlertQueue(fifoQueueUrl, REGION);

    await expect(
      queue.sendMessage({
        messageBody: JSON.stringify({ id: randomUUID(), kind: 'fifo' }),
        messageDeduplicationId: randomUUID(),
        messageGroupId: 'integration-test',
      }),
    ).resolves.toBeUndefined();
  });
});
