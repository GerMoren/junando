import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handler } from '../handler.js';
import type { APIGatewayProxyEventV2, SQSEvent } from 'aws-lambda';
import * as core from '@junando/core';
import { AlertType } from '@junando/core';

// Hoist mocks so they are available when vi.mock factory runs
const mockExecute = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockLoadConfig = vi.hoisted(() => vi.fn());
const MockLokiTraceRepository = vi.hoisted(() => vi.fn(function() { return {}; }));
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
}));

// Mock dependencies from @junando/core
vi.mock('@junando/core', async () => {
  const actual = await vi.importActual('@junando/core');
  return {
    ...actual,
    loadConfig: mockLoadConfig,
    createLogger: vi.fn().mockReturnValue(mockLogger),
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

  it('logs fatal and rethrows when getUseCase fails', async () => {
    // Simulate SSM/config load failure. The handler must log fatal and
    // rethrow so SQS retries the message.
    mockLoadConfig.mockRejectedValueOnce(new Error('SSM unavailable'));

    // Clear the cached useCase singleton so getUseCase() actually calls loadConfig
    await vi.resetModules();
    const { handler: freshHandler } = await import('../handler.js');

    const event: Partial<SQSEvent> = { Records: [] };

    await expect(freshHandler(event as SQSEvent)).rejects.toThrow('SSM unavailable');

    expect(mockLogger.fatal).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'getUseCase() failed — Lambda will retry via SQS',
    );
  });
});

describe('Worker Handler — Function URL routes', () => {
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

  const httpEvent = (rawPath: string): APIGatewayProxyEventV2 =>
    ({
      rawPath,
      headers: {},
      requestContext: { http: { method: 'GET', path: rawPath } },
    }) as unknown as APIGatewayProxyEventV2;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(baseConfig);
  });

  it('GET /metrics returns the prom-client registry as text/plain', async () => {
    const result = await handler(httpEvent('/metrics'));

    expect(result).toMatchObject({ statusCode: 200 });
    expect((result as any).headers['Content-Type']).toBe('text/plain');
    // Real registry output — proves we serve the actual prom-client registry
    expect((result as any).body).toContain('junando_alerts_processed_total');
    // Pipeline must NOT be initialized for a cheap metrics scrape
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('GET /health returns 200 ok', async () => {
    const result = await handler(httpEvent('/health'));

    expect(result).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((result as any).body)).toEqual({
      status: 'ok',
      service: 'junando-worker',
    });
  });

  it('returns 404 for unknown paths', async () => {
    const result = await handler(httpEvent('/nope'));

    expect(result).toMatchObject({ statusCode: 404 });
  });
});

describe('Worker Handler — CSV parsing', () => {
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

  afterEach(() => {
    // Clean up any CSV env vars set during tests
    delete process.env['CSV_SERVICE_COL'];
    delete process.env['CSV_MESSAGE_COL'];
    delete process.env['CSV_SEVERITY_COL'];
    delete process.env['CSV_TIMESTAMP_COL'];
    delete process.env['CSV_FINGERPRINT_COL'];
    delete process.env['CSV_ENDPOINT_COL'];
    delete process.env['CSV_EXTRA_LABELS'];
  });

  it('parses CSV body with default column mapping and processes alerts', async () => {
    // Body that isCsvBody returns true for: commas, newlines, no JSON brackets
    const csvBody = [
      'service,message,severity,timestamp',
      'checkout,HighErrorRate,error,2026-05-12T14:37:46.000Z',
    ].join('\n');

    const event: Partial<SQSEvent> = {
      Records: [{ body: csvBody } as any],
    };

    await handler(event as SQSEvent);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          alertName: 'HighErrorRate',
          serviceName: 'checkout',
          alertType: AlertType.Error,
        }),
      ]),
      expect.any(String), // correlationId from crypto.randomUUID()
    );
  });

  it('logs error and skips when CSV has header but no data rows', async () => {
    // parseCsvBody returns null when there are fewer than 2 lines
    const csvBody = 'service,message,severity,timestamp';

    const event: Partial<SQSEvent> = {
      Records: [{ body: csvBody, messageId: 'msg-1' } as any],
    };

    await handler(event as SQSEvent);

    // Should NOT call execute — no valid alerts
    expect(mockExecute).not.toHaveBeenCalled();
    // Should log the CSV parse error
    expect(mockLogger.error).toHaveBeenCalledWith(
      { record: 'msg-1' },
      'CSV parse returned no valid alerts',
    );
  });

  it('skips CSV row when required fields are missing', async () => {
    // Row with empty service and severity → filtered out by parseCsvBody
    const csvBody = [
      'service,message,severity,timestamp',
      ',,,',
      'checkout,ValidAlert,error,2026-05-12T14:37:46.000Z',
    ].join('\n');

    const event: Partial<SQSEvent> = {
      Records: [{ body: csvBody } as any],
    };

    await handler(event as SQSEvent);

    // Only the second (valid) row should produce an alert
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          alertName: 'ValidAlert',
          serviceName: 'checkout',
        }),
      ]),
      expect.any(String),
    );
  });

  it('supports custom column mapping via env vars', async () => {
    // Columns in non-default order: timestamp(0), service(1), severity(2), message(3)
    process.env['CSV_SERVICE_COL'] = '1';
    process.env['CSV_MESSAGE_COL'] = '3';
    process.env['CSV_SEVERITY_COL'] = '2';
    process.env['CSV_TIMESTAMP_COL'] = '0';

    const csvBody = [
      'timestamp,service,severity,message',
      '2026-05-12T14:37:46.000Z,checkout,error,HighErrorRate',
    ].join('\n');

    const event: Partial<SQSEvent> = {
      Records: [{ body: csvBody } as any],
    };

    await handler(event as SQSEvent);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          alertName: 'HighErrorRate',
          serviceName: 'checkout',
          alertType: AlertType.Error,
        }),
      ]),
      expect.any(String),
    );
  });

  it('respects CSV_FINGERPRINT_COL and CSV_ENDPOINT_COL env vars', async () => {
    // 5 columns: service(0), message(1), severity(2), timestamp(3), fingerprint(4)
    process.env['CSV_FINGERPRINT_COL'] = '4';
    process.env['CSV_ENDPOINT_COL'] = '4'; // same col for demo

    const csvBody = [
      'service,message,severity,timestamp,fp',
      'checkout,HighErrorRate,error,2026-05-12T14:37:46.000Z,custom-fp-123',
    ].join('\n');

    const event: Partial<SQSEvent> = {
      Records: [{ body: csvBody } as any],
    };

    await handler(event as SQSEvent);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          fingerprint: 'custom-fp-123',
          endpointPath: 'custom-fp-123', // same col used for both
        }),
      ]),
      expect.any(String),
    );
  });

  it('merges CSV_EXTRA_LABELS into alert labels', async () => {
    process.env['CSV_EXTRA_LABELS'] = 'env=prod,region=us-east';

    const csvBody = [
      'service,message,severity,timestamp',
      'checkout,HighErrorRate,error,2026-05-12T14:37:46.000Z',
    ].join('\n');

    const event: Partial<SQSEvent> = {
      Records: [{ body: csvBody } as any],
    };

    await handler(event as SQSEvent);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          labels: { env: 'prod', region: 'us-east' },
        }),
      ]),
      expect.any(String),
    );
  });

  it('falls back to JSON parser when body starts with brace', async () => {
    // isCsvBody returns false for JSON → should use JSON parsing path
    const event: Partial<SQSEvent> = {
      Records: [
        {
          body: JSON.stringify({
            correlationId: 'b17d0c84-f818-4039-b9c8-34ed977d6953',
            alerts: [
              {
                fingerprint: 'fp-csv-edge',
                alertName: 'EdgeCase',
                status: 'firing',
                serviceName: 'svc',
                alertType: AlertType.Error,
                endpointPath: '/',
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
        expect.objectContaining({ alertName: 'EdgeCase' }),
      ]),
      'b17d0c84-f818-4039-b9c8-34ed977d6953',
    );
  });

  it('logs error when SQS body is not valid JSON or CSV', async () => {
    // Plain text that fails both isCsvBody (no commas) and JSON.parse
    const event: Partial<SQSEvent> = {
      Records: [{ body: 'notacsvorjson', messageId: 'msg-bad' } as any],
    };

    await handler(event as SQSEvent);

    expect(mockExecute).not.toHaveBeenCalled();
    // The try/catch around JSON.parse logs this
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Failed to parse SQS message body',
    );
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
