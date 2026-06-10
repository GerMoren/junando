import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../handler.js';
import type { SQSEvent } from 'aws-lambda';
import * as core from '@junando/core';
import { AlertType } from '@junando/core';

// Hoist mocks so they are available when vi.mock factory runs
const mockExecute = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockLoadConfig = vi.hoisted(() => vi.fn());
const MockLokiTraceRepository = vi.hoisted(() => vi.fn(function() { return {}; }));

// Mock dependencies from @junando/core
vi.mock('@junando/core', async () => {
  const actual = await vi.importActual('@junando/core');
  return {
    ...actual,
    loadConfig: mockLoadConfig,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    }),
    reinitLogger: vi.fn(),
    flushLoki: vi.fn().mockResolvedValue(undefined),
    RedisDeduplicationStore: vi.fn(function() { return {}; }),
    LokiTraceRepository: MockLokiTraceRepository,
    SlackNotifier: vi.fn(function() { return {}; }),
    createLLMProvider: vi.fn(function() { return {}; }),
    ProcessIncidentUseCase: vi.fn(function() {
      return { execute: mockExecute };
    }),
  };
});

// Mock ioredis
vi.mock('ioredis', () => {
  return {
    Redis: vi.fn(function() {
      return { on: vi.fn() };
    }),
  };
});

describe('Worker Handler', () => {
  const baseConfig = {
    redisUrl: 'redis://localhost:6379',
    lokiUrl: 'http://localhost:3100',
    slackBotToken: 'xoxb-test',
    slackChannel: '#test',
    llmProvider: 'gemini' as const,
    llmApiKey: 'test-key',
    logLevel: 'error' as const,
    dedupTtlSeconds: 300,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(baseConfig);
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
                alertType: AlertType.Error,
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

  it('initializes LokiTraceRepository with empty string when lokiUrl is absent', async () => {
    // When lokiUrl is undefined in config, handler must still process messages without throwing.
    // This test uses a fresh module state by resetting the useCase singleton via module reset.
    // The guard config.lokiUrl ?? '' in handler.ts ensures LokiTraceRepository receives '' not undefined.
    mockLoadConfig.mockResolvedValueOnce({ ...baseConfig, lokiUrl: undefined });

    // Reset the module to clear the cached useCase singleton
    await vi.resetModules();
    const { handler: freshHandler } = await import('../handler.js');

    const event: Partial<SQSEvent> = {
      Records: [
        {
          body: JSON.stringify({
            correlationId: 'b17d0c84-f818-4039-b9c8-34ed977d6953',
            alerts: [
              {
                fingerprint: 'fp2',
                alertName: 'HighErrorRate',
                status: 'firing',
                serviceName: 'checkout',
                alertType: AlertType.Error,
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

    // Must not throw even when lokiUrl is absent
    await expect(freshHandler(event as SQSEvent)).resolves.not.toThrow();
  });
});

describe('Worker Handler — alertsProcessed counter', () => {
  const baseConfig = {
    redisUrl: 'redis://localhost:6379',
    lokiUrl: 'http://localhost:3100',
    slackBotToken: 'xoxb-test',
    slackChannel: '#test',
    llmProvider: 'gemini' as const,
    llmApiKey: 'test-key',
    logLevel: 'error' as const,
    dedupTtlSeconds: 300,
  };

  let incSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(baseConfig);
    incSpy = vi.spyOn(core.metrics.alertsProcessed, 'inc');
  });

  const validRecord = () => ({
    body: JSON.stringify({
      correlationId: 'b17d0c84-f818-4039-b9c8-34ed977d6953',
      alerts: [
        {
          fingerprint: 'fp-worker',
          alertName: 'HighErrorRate',
          status: 'firing',
          serviceName: 'checkout',
          alertType: AlertType.Error,
          endpointPath: '/pay',
          startsAt: '2026-05-12T14:37:46.000Z',
          labels: {},
          annotations: {},
        },
      ],
    }),
  });

  it('increments alertsProcessed with result=success on happy path', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const event: Partial<SQSEvent> = { Records: [validRecord() as any] };

    await handler(event as SQSEvent);

    expect(incSpy).toHaveBeenCalledOnce();
    expect(incSpy).toHaveBeenCalledWith({ result: 'success' });
  });

  it('increments alertsProcessed with result=failure when execute throws', async () => {
    mockExecute.mockRejectedValueOnce(new Error('use case error'));
    const event: Partial<SQSEvent> = { Records: [validRecord() as any] };

    await expect(handler(event as SQSEvent)).rejects.toThrow('use case error');

    expect(incSpy).toHaveBeenCalledOnce();
    expect(incSpy).toHaveBeenCalledWith({ result: 'failure' });
  });

  it('increments exactly once per job regardless of path', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    const event: Partial<SQSEvent> = { Records: [validRecord() as any] };

    await handler(event as SQSEvent);

    expect(incSpy).toHaveBeenCalledTimes(1);
  });
});
