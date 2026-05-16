import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SQSClient } from '@aws-sdk/client-sqs';

// Import the pure processBatch function — does NOT exist yet (RED)
import { processBatch, type BatchDeps } from '../worker-batch.js';

const mockSend = vi.fn();
const mockSqsClient = { send: mockSend } as unknown as SQSClient;

const mockHandler = vi.fn();
const mockFlushLoki = vi.fn().mockResolvedValue(undefined);
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

function makeDeps(overrides: Partial<BatchDeps> = {}): BatchDeps {
  return {
    sqsClient: mockSqsClient,
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/test',
    handler: mockHandler,
    flushLoki: mockFlushLoki,
    logger: mockLogger as unknown as BatchDeps['logger'],
    ...overrides,
  };
}

const sampleMessage = {
  MessageId: 'msg-1',
  ReceiptHandle: 'rh-1',
  Body: JSON.stringify({ correlationId: 'c1', alerts: [] }),
};

describe('processBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlushLoki.mockResolvedValue(undefined);
  });

  it('deletes all messages when handler succeeds', async () => {
    mockSend
      .mockResolvedValueOnce({ Messages: [sampleMessage] })  // ReceiveMessage
      .mockResolvedValueOnce({});                            // DeleteMessageBatch

    mockHandler.mockResolvedValueOnce(undefined);

    await processBatch(makeDeps());

    // DeleteMessageBatch must have been called
    expect(mockSend).toHaveBeenCalledTimes(2);
    // Second call should be DeleteMessageBatch
    const deleteCall = mockSend.mock.calls[1][0];
    expect(deleteCall.input.Entries).toHaveLength(1);
    expect(deleteCall.input.Entries[0].ReceiptHandle).toBe('rh-1');
  });

  it('does NOT delete messages when handler throws', async () => {
    mockSend.mockResolvedValueOnce({ Messages: [sampleMessage] }); // ReceiveMessage only

    mockHandler.mockRejectedValueOnce(new Error('handler blew up'));

    await processBatch(makeDeps());

    // Only ReceiveMessage was sent, no DeleteMessageBatch
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('calls flushLoki after a successful batch', async () => {
    mockSend
      .mockResolvedValueOnce({ Messages: [sampleMessage] })
      .mockResolvedValueOnce({});
    mockHandler.mockResolvedValueOnce(undefined);

    await processBatch(makeDeps());

    expect(mockFlushLoki).toHaveBeenCalledOnce();
  });

  it('calls flushLoki even when handler throws', async () => {
    mockSend.mockResolvedValueOnce({ Messages: [sampleMessage] });
    mockHandler.mockRejectedValueOnce(new Error('boom'));

    await processBatch(makeDeps());

    expect(mockFlushLoki).toHaveBeenCalledOnce();
  });

  it('does nothing (no delete, no handler) when queue is empty', async () => {
    mockSend.mockResolvedValueOnce({ Messages: [] });

    await processBatch(makeDeps());

    expect(mockHandler).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1); // only ReceiveMessage
    expect(mockFlushLoki).not.toHaveBeenCalled();
  });
});
