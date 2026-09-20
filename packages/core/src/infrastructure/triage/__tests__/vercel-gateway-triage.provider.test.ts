import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import { AlertType } from '../../../shared/constants.js';
import { VercelGatewayTriageProvider } from '../vercel-gateway-triage.provider.js';

// ── Logger mock ────────────────────────────────────────────────────────────
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../shared/logger/index.js', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function makeCluster(overrides: Partial<AlertCluster> = {}): AlertCluster {
  return {
    fingerprint: 'fp123',
    serviceName: 'checkout-service',
    alertType: AlertType.Error,
    endpointPath: '/api/v1/checkout',
    alertCount: 5,
    representativeTraceIds: ['trace-1'],
    firstSeenAt: '2026-05-08T10:00:00.000Z',
    latencyP99Ms: 1200,
    ...overrides,
  };
}

function mockContentResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ index: 0, message: { role: 'assistant', content } }],
    }),
  };
}

describe('VercelGatewayTriageProvider', () => {
  const mockFetch = vi.fn();
  let provider: VercelGatewayTriageProvider;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    provider = new VercelGatewayTriageProvider('test-key', 'anthropic/claude-3-5-haiku');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['low', 'low'],
    ['LOW', 'low'],
    ['Low', 'low'],
    ['low ', 'low'],
    ['medium', 'medium'],
    ['MEDIUM', 'medium'],
    ['high', 'high'],
    ['HIGH', 'high'],
    ['critical', 'critical'],
    ['CRITICAL', 'critical'],
  ])('classifies response %j as severity %j', async (raw, expected) => {
    mockFetch.mockResolvedValue(mockContentResponse(raw));

    const result = await provider.classify(makeCluster());

    expect(result.severity).toBe(expected);
  });

  it('defaults to medium on an unparseable response', async () => {
    mockFetch.mockResolvedValue(mockContentResponse('I think this is pretty bad'));

    const result = await provider.classify(makeCluster());

    expect(result.severity).toBe('medium');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('defaults to medium on an empty response', async () => {
    mockFetch.mockResolvedValue(mockContentResponse(''));

    const result = await provider.classify(makeCluster());

    expect(result.severity).toBe('medium');
  });

  it('defaults to medium on a non-ok HTTP status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await provider.classify(makeCluster());

    expect(result.severity).toBe('medium');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('defaults to medium on a network error', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const result = await provider.classify(makeCluster());

    expect(result.severity).toBe('medium');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('sends max_tokens: 32 and the correct model/messages shape', async () => {
    mockFetch.mockResolvedValue(mockContentResponse('low'));

    await provider.classify(makeCluster());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('anthropic/claude-3-5-haiku');
    expect(body.max_tokens).toBe(32);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('checkout-service');
  });
});
