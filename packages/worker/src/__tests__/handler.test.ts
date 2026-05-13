import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../handler.js';
import type { SQSEvent } from 'aws-lambda';

// Define a shared mock for the use case instance
const mockExecute = vi.fn().mockResolvedValue(undefined);

// Mock dependencies from @junando/core
vi.mock('@junando/core', async () => {
  const actual = await vi.importActual('@junando/core');
  return {
    ...actual,
    loadConfig: vi.fn().mockResolvedValue({
      redisUrl: 'redis://localhost:6379',
      lokiUrl: 'http://localhost:3100',
      slackBotToken: 'xoxb-test',
      slackChannel: '#test',
      llmProvider: 'gemini',
      llmApiKey: 'test-key',
      logLevel: 'error',
      dedupTtlSeconds: 300,
    }),
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    RedisDeduplicationStore: vi.fn().mockImplementation(() => ({})),
    LokiTraceRepository: vi.fn().mockImplementation(() => ({})),
    SlackNotifier: vi.fn().mockImplementation(() => ({})),
    createLLMProvider: vi.fn().mockImplementation(() => ({})),
    ProcessIncidentUseCase: vi.fn().mockImplementation(() => ({
      execute: mockExecute,
    })),
  };
});

// Mock ioredis
vi.mock('ioredis', () => {
  return {
    Redis: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
    })),
  };
});

describe('Worker Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes valid SQS messages successfully', async () => {
    const event: Partial<SQSEvent> = {
      Records: [
        {
          body: JSON.stringify({
            correlationId: 'b17d0c84-f818-4039-b9c8-34ed977d6953',
            alerts: [
              {
                fingerprint: 'fp1',
                alertName: 'HighErrorRate',
                status: 'firing',
                serviceName: 'checkout',
                alertType: 'http_500',
                endpointPath: '/pay',
                startsAt: '2026-05-12T14:37:46.000Z',
                labels: {},
                annotations: {},
              },
            ],
          }),
        } as any,
      ],
    };

    await handler(event as SQSEvent);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          alertName: 'HighErrorRate',
          fingerprint: 'fp1',
        }),
      ]),
      'b17d0c84-f818-4039-b9c8-34ed977d6953'
    );
  });

  it('skips invalid SQS messages without crashing', async () => {
    const event: Partial<SQSEvent> = {
      Records: [
        {
          body: 'invalid-json',
        } as any,
        {
          body: JSON.stringify({ correlationId: 'invalid-schema' }),
        } as any,
      ],
    };

    await handler(event as SQSEvent);

    expect(mockExecute).not.toHaveBeenCalled();
  });
});
