import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../handler.js';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createHmac } from 'node:crypto';

// Mock SQS
const mockSend = vi.fn().mockResolvedValue({ MessageId: 'msg-123' });
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendMessageCommand: vi.fn().mockImplementation((args) => args),
}));

// Mock @junando/core
vi.mock('@junando/core', async () => {
  const actual = await vi.importActual('@junando/core');
  return {
    ...actual,
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

  it('processes valid alerts and publishes to SQS', async () => {
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
    expect(mockSend).toHaveBeenCalled();
  });

  it('returns 422 for invalid alert payload', async () => {
    const event = {
      rawPath: '/webhook/alert',
      body: JSON.stringify({ invalid: 'payload' }),
    } as Partial<APIGatewayProxyEventV2>;

    const result = await handler(event as APIGatewayProxyEventV2);
    expect(result).toMatchObject({ statusCode: 422 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('verifies slack signature correctly', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = 'payload=' + encodeURIComponent(JSON.stringify({ type: 'block_actions', user: { username: 'test' } }));
    const secret = 'test-secret';
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac('sha256', secret);
    hmac.update(baseString, 'utf8');
    const signature = `v0:${hmac.digest('hex')}`;

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
              summary: 'a'.repeat(260000) // Trigger truncation (> 250KB)
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
    expect(mockSend).toHaveBeenCalled();
    
    const command = mockSend.mock.calls[0][0];
    const body = JSON.parse(command.MessageBody);
    expect(body.alerts[0].annotations.summary.length).toBeLessThan(260000);
  });
});

