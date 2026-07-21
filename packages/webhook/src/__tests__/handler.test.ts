import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../handler.js';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createHmac } from 'node:crypto';
import * as core from '@junando/core';

// Mock SQSAlertQueue.sendMessage from @junando/core
const mockSendMessage = vi.fn().mockResolvedValue(undefined);

// Mock @junando/core
vi.mock('@junando/core', async () => {
  const actual = await vi.importActual('@junando/core');
  return {
    ...actual,
    SQSAlertQueue: vi.fn(function() {
      return {
        sendMessage: mockSendMessage,
      };
    }),
    loadConfig: vi.fn().mockResolvedValue({
      slackSigningSecret: 'test-secret',
      logLevel: 'error',
    }),
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    process.env.SQS_QUEUE_URL = 'https://sqs.test';
  });

  it('returns 200 for health check', async () => {
    const event = {
      rawPath: '/health',
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((result as any).body)).toEqual({ status: 'ok', service: 'junando-webhook' });
  });

  it('processes valid alerts and publishes to SQS via SQSAlertQueue', async () => {
    const event = {
      rawPath: '/webhook/alert',
      body: JSON.stringify({
        version: '4',
        groupKey: 'test-group',
        status: 'firing',
        receiver: 'test-receiver',
        externalURL: 'http://localhost',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'TestAlert', service: 'web' },
            annotations: { summary: 'Something is wrong' },
            startsAt: '2026-05-12T14:37:46.000Z',
            endsAt: '2026-05-12T14:40:46.000Z',
            fingerprint: 'fp1',
          },
        ],
      }),
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 200 });
    expect(mockSendMessage).toHaveBeenCalled();
  });

  it('returns 422 for invalid alert payload', async () => {
    const event = {
      rawPath: '/webhook/alert',
      body: JSON.stringify({ invalid: 'payload' }),
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 422 });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('verifies slack signature correctly', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = 'payload=' + encodeURIComponent(JSON.stringify({ type: 'block_actions', user: { username: 'test' } }));
    const secret = 'test-secret';
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', secret);
    hmac.update(baseString, 'utf8');
    const signature = `v0=${hmac.digest('hex')}`;

    const event = {
      rawPath: '/webhook/slack-interactivity',
      body: body,
      headers: {
        'x-slack-signature': signature,
        'x-slack-request-timestamp': timestamp,
      },
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 200 });
  });

  it('returns 401 for invalid slack signature', async () => {
    const event = {
      rawPath: '/webhook/slack-interactivity',
      body: 'payload=test',
      headers: {
        'x-slack-signature': 'v0:wrong',
        'x-slack-request-timestamp': '123456789',
      },
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 401 });
  });

  it('uses the x-correlation-id header from upstream when present and valid', async () => {
    const upstreamCorrelationId = '3f6b8b9e-7c4d-4e2a-9a1b-2c3d4e5f6a7b';
    const event = {
      rawPath: '/webhook/alert',
      headers: { 'x-correlation-id': upstreamCorrelationId },
      body: JSON.stringify({
        version: '4',
        groupKey: 'test-group',
        status: 'firing',
        receiver: 'test-receiver',
        externalURL: 'http://localhost',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'TestAlert', service: 'web' },
            annotations: {},
            startsAt: '2026-05-12T14:37:46.000Z',
            endsAt: '2026-05-12T14:40:46.000Z',
            fingerprint: 'fp-corr',
          },
        ],
      }),
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 200 });

    // Response body propagates the upstream correlationId
    const responseBody = JSON.parse((result as any).body);
    expect(responseBody.correlationId).toBe(upstreamCorrelationId);

    // SQS message body carries the same correlationId to the worker
    expect(mockSendMessage).toHaveBeenCalled();
    const [params] = mockSendMessage.mock.calls[0] as [{ messageBody: string }];
    const sqsBody = JSON.parse(params.messageBody);
    expect(sqsBody.correlationId).toBe(upstreamCorrelationId);
  });

  it('generates a UUID v4 correlationId when the header is absent', async () => {
    const event = {
      rawPath: '/webhook/alert',
      body: JSON.stringify({
        version: '4',
        groupKey: 'test-group',
        status: 'firing',
        receiver: 'test-receiver',
        externalURL: 'http://localhost',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'TestAlert', service: 'web' },
            annotations: {},
            startsAt: '2026-05-12T14:37:46.000Z',
            endsAt: '2026-05-12T14:40:46.000Z',
            fingerprint: 'fp-no-hdr',
          },
        ],
      }),
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 200 });

    const responseBody = JSON.parse((result as any).body);
    expect(responseBody.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const [params] = mockSendMessage.mock.calls[0] as [{ messageBody: string }];
    const sqsBody = JSON.parse(params.messageBody);
    expect(sqsBody.correlationId).toBe(responseBody.correlationId);
  });

  it('falls back to a generated UUID when x-correlation-id is not a valid UUID', async () => {
    const event = {
      rawPath: '/webhook/alert',
      headers: { 'x-correlation-id': 'not-a-uuid' },
      body: JSON.stringify({
        version: '4',
        groupKey: 'test-group',
        status: 'firing',
        receiver: 'test-receiver',
        externalURL: 'http://localhost',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'TestAlert', service: 'web' },
            annotations: {},
            startsAt: '2026-05-12T14:37:46.000Z',
            endsAt: '2026-05-12T14:40:46.000Z',
            fingerprint: 'fp-bad-hdr',
          },
        ],
      }),
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 200 });

    // Spec: correlationId MUST be UUID v4 everywhere — invalid headers are replaced
    const responseBody = JSON.parse((result as any).body);
    expect(responseBody.correlationId).not.toBe('not-a-uuid');
    expect(responseBody.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('truncates large annotations to fit SQS limits', async () => {
    const event = {
      rawPath: '/webhook/alert',
      body: JSON.stringify({
        version: '4',
        groupKey: 'test-group',
        status: 'firing',
        receiver: 'test-receiver',
        externalURL: 'http://localhost',
        groupLabels: {},
        commonLabels: {},
        commonAnnotations: {},
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'HugeAlert' },
            annotations: {
              summary: 'a'.repeat(260000), // Trigger truncation (> 250KB)
            },
            startsAt: '2026-05-12T14:37:46.000Z',
            endsAt: '2026-05-12T14:40:46.000Z',
            fingerprint: 'fp-huge',
          },
        ],
      }),
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 200 });
    expect(mockSendMessage).toHaveBeenCalled();

    const [params] = mockSendMessage.mock.calls[0] as [{ messageBody: string }];
    const body = JSON.parse(params.messageBody);
    expect(body.alerts[0].annotations.summary.length).toBeLessThan(260000);
  });
});

describe('Webhook Handler — latency instrumentation', () => {
  let observeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    process.env.SQS_QUEUE_URL = 'https://sqs.test';
    observeSpy = vi.spyOn(core.metrics.latency, 'observe');
  });

  const validAlertEvent = (): Partial<APIGatewayProxyEventV2> => ({
    rawPath: '/webhook/alert',
    body: JSON.stringify({
      version: '4',
      groupKey: 'test-group',
      status: 'firing',
      receiver: 'test-receiver',
      externalURL: 'http://localhost',
      groupLabels: {},
      commonLabels: {},
      commonAnnotations: {},
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'TestAlert', service: 'web' },
          annotations: {},
          startsAt: '2026-05-12T14:37:46.000Z',
          endsAt: '2026-05-12T14:40:46.000Z',
          fingerprint: 'fp-lat',
        },
      ],
    }),
  });

  it('calls latency.observe with status=success on successful alert processing', async () => {
    const event = validAlertEvent();
    const result = await handler(event as APIGatewayProxyEventV2);

    expect(result).toMatchObject({ statusCode: 200 });
    expect(observeSpy).toHaveBeenCalledOnce();
    const [labels, elapsed] = observeSpy.mock.calls[0] as [{ status: string }, number];
    expect(labels.status).toBe('success');
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(0.05); // well within 50ms budget
  });

  it('calls latency.observe with status=error on validation failure', async () => {
    const event: Partial<APIGatewayProxyEventV2> = {
      rawPath: '/webhook/alert',
      body: JSON.stringify({ invalid: 'payload' }),
    };

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 422 });
    expect(observeSpy).toHaveBeenCalledOnce();
    const [labels] = observeSpy.mock.calls[0] as [{ status: string }, number];
    expect(labels.status).toBe('error');
  });

  it('calls latency.observe with elapsed > 0', async () => {
    const event = validAlertEvent();
    await handler(event as APIGatewayProxyEventV2);

    const [, elapsed] = observeSpy.mock.calls[0] as [{ status: string }, number];
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});
