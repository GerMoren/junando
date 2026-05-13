import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handler } from '../handler.js';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// Mock the SQSClient
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ MessageId: 'test-message-id' }),
  })),
  SendMessageCommand: vi.fn(),
}));

// Mock config - needed for Slack signature verification
vi.mock('@junando/core', async () => {
  const actual = await vi.importActual('@junando/core');
  return {
    ...actual,
    loadConfig: vi.fn().mockResolvedValue({
      slackSigningSecret: 'test-signing-secret',
      slackBotToken: 'test-bot-token',
      slackChannel: 'test-channel',
      sqsQueueUrl: 'https://sqs.test.amazonaws.com/test-queue',
      llmProvider: 'openai',
      llmApiKey: 'test-key',
      llmModel: 'gpt-4',
      dedupTtlSeconds: 300,
    }),
  };
});

// Helper to create API Gateway event
function createEvent(path: string, body: string | null, options: {
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
} = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: path,
    rawPath: path,
    body: body,
    isBase64Encoded: options.isBase64Encoded ?? false,
    headers: options.headers ?? {},
    requestContext: {
      accountId: 'test-account',
      apiId: 'test-api',
      domainName: 'test.execute-api.amazonaws.com',
      domainPrefix: 'test',
      requestId: 'test-request-id',
      requestTime: '2026-05-12T12:00:00Z',
      requestTimeEpoch: 1715515200000,
      stage: 'test',
      protocol: 'HTTP/1.1',
      identity: { sourceIp: '127.0.0.1' },
      http: { method: 'GET', path: path, protocol: 'HTTP/1.1' },
    },
  };
}


describe('Webhook Lambda Handler', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset environment for each test
    delete process.env.SQS_QUEUE_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('returns 200 with correct JSON', async () => {
      const event = createEvent('/health', null);
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body!);
      expect(body).toEqual({ status: 'ok', service: 'junando-webhook' });
    });
  });

  describe('GET /metrics', () => {
    it('returns 200 with Prometheus metrics', async () => {
      const event = createEvent('/metrics', null);
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(response.headers?.['Content-Type']).toBe('text/plain');
      expect(response.body).toContain('# TYPE');
    });
  });

  describe('POST /webhook/alert — empty alerts (all resolved)', () => {
    it('returns 200 with accepted=0 when all alerts are resolved', async () => {
      const payload = {
        version: '4',
        groupKey: 'test-group',
        status: 'resolved',
        receiver: 'test-receiver',
        groupLabels: { alertname: 'TestAlert' },
        commonLabels: {},
        commonAnnotations: {},
        externalURL: 'http://localhost:9093',
        alerts: [
          {
            status: 'resolved',
            labels: { alertname: 'TestAlert', service: 'test-service' },
            annotations: {},
            startsAt: '2026-05-12T10:00:00Z',
            endsAt: '2026-05-12T10:05:00Z',
            fingerprint: 'fp-resolved',
          },
        ],
      };

      const event = createEvent('/webhook/alert', JSON.stringify(payload));
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body!);
      expect(body.accepted).toBe(0);
    });
  });

  describe('POST /webhook/slack-interactivity — error paths', () => {
    const createSlackEvent = (body: string, overrides: {
      signature?: string;
      timestamp?: string;
    } = {}): APIGatewayProxyEventV2 => {
      const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000).toString();
      const { createHmac } = require('crypto');
      const baseString = `v0:${timestamp}:${body}`;
      const hmac = createHmac('sha256', 'test-signing-secret');
      hmac.update(baseString, 'utf8');
      const signature = `v0=${hmac.digest('hex')}`;

      return createEvent('/webhook/slack-interactivity', body, {
        headers: {
          'x-slack-signature': overrides.signature ?? signature,
          'x-slack-request-timestamp': timestamp,
        },
      });
    };

    it('returns 400 for invalid JSON in Slack payload', async () => {
      const body = 'payload=' + encodeURIComponent('not-valid-json{');
      const event = createSlackEvent(body);

      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('Invalid JSON');
    });

    it('returns 422 for invalid Slack payload schema', async () => {
      // type is required and must be a string - pass number to fail validation
      const payload = { type: 12345, user: { username: 'test' } };
      const body = 'payload=' + encodeURIComponent(JSON.stringify(payload));
      const event = createSlackEvent(body);

      const response = await handler(event);

      expect(response.statusCode).toBe(422);
    });

    it('returns 200 and logs action when Slack action is present', async () => {
      const payload = {
        type: 'block_actions',
        user: { username: 'test-user', id: 'U12345' },
        actions: [
          { action_id: 'ack_alert', value: 'fp-123', type: 'button' },
        ],
        container: { message_ts: '1234567890.123456' },
        message: { ts: '1234567890.123456' },
      };
      const body = 'payload=' + encodeURIComponent(JSON.stringify(payload));
      const event = createSlackEvent(body);

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /webhook/alert — local dev inline path (no SQS_QUEUE_URL)', () => {
    it('executes inline pipeline when SQS_QUEUE_URL is not set', async () => {
      // SQS_QUEUE_URL is already deleted in beforeEach
      const payload = {
        version: '4',
        groupKey: 'test-group',
        status: 'firing',
        receiver: 'test-receiver',
        groupLabels: { alertname: 'TestAlert' },
        commonLabels: {},
        commonAnnotations: {},
        externalURL: 'http://localhost:9093',
        alerts: [
          {
            status: 'firing',
            labels: { alertname: 'TestAlert', service: 'test-service' },
            annotations: { summary: 'Test alert inline' },
            startsAt: '2026-05-12T10:00:00Z',
            endsAt: '0001-01-01T00:00:00Z',
            fingerprint: 'fp-inline-test',
          },
        ],
      };

      const event = createEvent('/webhook/alert', JSON.stringify(payload));
      const response = await handler(event);

      // Inline path returns 200 immediately (fire-and-forget)
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body!);
      expect(body.accepted).toBe(1);
      expect(body.correlationId).toBeDefined();
    });
  });
});