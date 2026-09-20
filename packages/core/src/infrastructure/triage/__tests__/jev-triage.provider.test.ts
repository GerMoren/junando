import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import { AlertType } from '../../../shared/constants.js';
import { JevTriageProvider } from '../jev-triage.provider.js';

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

function mockEvaluateResponse(choice: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'typesafe-ai/jev',
      answers: {
        severity: {
          type: 'choice',
          choice,
          probabilities: { [choice]: 0.98 },
          confidence: 0.98,
        },
      },
    }),
  };
}

describe('JevTriageProvider', () => {
  const mockFetch = vi.fn();
  let provider: JevTriageProvider;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    provider = new JevTriageProvider('test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the correct request shape to the Evaluation API', async () => {
    mockFetch.mockResolvedValue(mockEvaluateResponse('critical'));

    await provider.classify(makeCluster());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/evaluate');
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('typesafe-ai/jev');
    expect(body.state).toContain('checkout-service');
    expect(body.questions.severity.type).toBe('choice');
    expect(body.questions.severity.criteria).toHaveProperty('low');
    expect(body.questions.severity.criteria).toHaveProperty('critical');
  });

  it('parses a critical classification', async () => {
    mockFetch.mockResolvedValue(mockEvaluateResponse('critical'));
    const result = await provider.classify(makeCluster());
    expect(result.severity).toBe('critical');
  });

  it('parses a low classification', async () => {
    mockFetch.mockResolvedValue(mockEvaluateResponse('low'));
    const result = await provider.classify(makeCluster());
    expect(result.severity).toBe('low');
  });

  it('defaults to medium on a non-ok HTTP status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await provider.classify(makeCluster());
    expect(result.severity).toBe('medium');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('defaults to medium when the answer is missing/unparseable', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ answers: {} }) });
    const result = await provider.classify(makeCluster());
    expect(result.severity).toBe('medium');
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('defaults to medium on a network error, never throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const result = await provider.classify(makeCluster());
    expect(result.severity).toBe('medium');
  });
});
