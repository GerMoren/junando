import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import { AlertType, LLMProviderType } from '../../../shared/constants.js';
import { createLLMProvider } from '../factory.js';
import { VercelGatewayProvider, VercelGatewayResponseSchema } from '../vercel-gateway.provider.js';

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
    representativeTraceIds: ['trace-1', 'trace-2'],
    firstSeenAt: '2026-05-08T10:00:00.000Z',
    latencyP99Ms: 1200,
    ...overrides,
  };
}

// ── VercelGatewayResponseSchema ─────────────────────────────────────────────

describe('VercelGatewayResponseSchema', () => {
  it('parses a valid response', () => {
    const valid = {
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    expect(VercelGatewayResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a response missing choices', () => {
    expect(VercelGatewayResponseSchema.safeParse({}).success).toBe(false);
  });
});

// ── VercelGatewayProvider ────────────────────────────────────────────────────

describe('VercelGatewayProvider', () => {
  const mockFetch = vi.fn();
  let provider: VercelGatewayProvider;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    provider = new VercelGatewayProvider('test-key', 'typesafeai/jev');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws at construction time when model is empty', () => {
    expect(() => new VercelGatewayProvider('test-key', '')).toThrow(
      'VercelGatewayProvider requires an explicit model',
    );
  });

  it('calls the Gateway with correct URL, headers, and body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                '{"probable_cause":"bad query","impacted_services":["api"],"recommended_steps":["fix query"],"urgency_level":"high","requires_rollback":false}',
            },
          },
        ],
      }),
    });

    await provider.analyze(makeCluster(), []);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('typesafeai/jev');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('parses LLMAnalysis from response content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                '{"probable_cause":"memory leak","impacted_services":["web"],"recommended_steps":["restart pod"],"urgency_level":"critical","requires_rollback":true}',
            },
          },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
      }),
    });

    const result = await provider.analyze(makeCluster(), []);

    expect(result.analysis?.probable_cause).toBe('memory leak');
    expect(result.analysis?.urgency_level).toBe('critical');
    expect(result.provider).toBe(LLMProviderType.VercelGateway);
    expect(result.model).toBe('typesafeai/jev');
    expect(result.promptTokens).toBe(42);
    expect(result.completionTokens).toBe(7);
  });

  it('throws when the Gateway responds with a non-ok status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(provider.analyze(makeCluster(), [])).rejects.toThrow(
      'Vercel AI Gateway request failed: 500',
    );
  });

  it('returns null analysis with degradedReason=unparseable_response on malformed content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: 'not json' } }],
      }),
    });

    const result = await provider.analyze(makeCluster(), []);
    expect(result.analysis).toBeNull();
    expect(result.degradedReason).toBe('unparseable_response');
  });
});

// ── Factory wiring ───────────────────────────────────────────────────────────

describe('createLLMProvider — vercel-gateway', () => {
  it('creates a VercelGatewayProvider for "vercel-gateway" string', () => {
    const provider = createLLMProvider('vercel-gateway', 'key', 'typesafeai/jev');
    expect(provider).toBeInstanceOf(VercelGatewayProvider);
  });
});
