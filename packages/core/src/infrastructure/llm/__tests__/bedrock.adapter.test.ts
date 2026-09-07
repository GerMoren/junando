import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import { AlertType } from '../../../shared/constants.js';
import { BedrockProvider } from '../llm.adapter.js';

// ── Logger mock ────────────────────────────────────────────────────────────
// Must include `debug` — the module-level logger is shared file-wide and
// OpenRouterProvider (same file) calls logger.debug.
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../shared/logger/index.js', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// ── Bedrock SDK mock ─────────────────────────────────────────────────────
const mockSend = vi.hoisted(() => vi.fn());
const mockClientCtor = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(function (this: unknown, ...args: unknown[]) {
    mockClientCtor(...args);
    return { send: mockSend };
  }),
  ConverseCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
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

const validAnalysisJson = JSON.stringify({
  probable_cause: 'Database connection pool exhaustion',
  impacted_services: ['checkout-service'],
  recommended_steps: ['Check pool size'],
  urgency_level: 'high',
  requires_rollback: false,
});

function converseResponse(text: string, promptTokens = 10, completionTokens = 20) {
  return {
    output: { message: { content: [{ text }] } },
    usage: { inputTokens: promptTokens, outputTokens: completionTokens },
  };
}

describe('BedrockProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps a successful Converse response into the result shape', async () => {
    mockSend.mockResolvedValueOnce(converseResponse(validAnalysisJson, 15, 25));

    const provider = new BedrockProvider('us.amazon.nova-lite-v1:0');
    const result = await provider.analyze(makeCluster(), []);

    expect(result.provider).toBe('bedrock');
    expect(result.model).toBe('us.amazon.nova-lite-v1:0');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.promptTokens).toBe(15);
    expect(result.completionTokens).toBe(25);
    expect(result.analysis).toEqual({
      probable_cause: 'Database connection pool exhaustion',
      impacted_services: ['checkout-service'],
      recommended_steps: ['Check pool size'],
      urgency_level: 'high',
      requires_rollback: false,
    });
    expect('degradedReason' in result).toBe(false);
  });

  it('builds the client lazily — once per provider instance', async () => {
    mockSend.mockResolvedValue(converseResponse(validAnalysisJson));
    const provider = new BedrockProvider();
    expect(mockClientCtor).not.toHaveBeenCalled();

    await provider.analyze(makeCluster(), []);
    await provider.analyze(makeCluster(), []);

    expect(mockClientCtor).toHaveBeenCalledTimes(1);
  });

  for (const name of ['ThrottlingException', 'ServiceUnavailableException', 'InternalServerException']) {
    it(`maps ${name} to degradedReason 'provider_unavailable'`, async () => {
      const error = new Error(name);
      error.name = name;
      mockSend.mockRejectedValueOnce(error);

      const provider = new BedrockProvider();
      const result = await provider.analyze(makeCluster(), []);

      expect(result.degradedReason).toBe('provider_unavailable');
      expect(result.analysis).toBeNull();
    });
  }

  it("maps ModelTimeoutException to the existing 'timeout' reason", async () => {
    const error = new Error('ModelTimeoutException');
    error.name = 'ModelTimeoutException';
    mockSend.mockRejectedValueOnce(error);

    const provider = new BedrockProvider();
    const result = await provider.analyze(makeCluster(), []);

    expect(result.degradedReason).toBe('timeout');
    expect(result.analysis).toBeNull();
  });

  for (const name of ['AccessDeniedException', 'ValidationException', 'ResourceNotFoundException', 'SomeUnknownError']) {
    it(`rethrows for unrecognized/non-transient error "${name}"`, async () => {
      const error = new Error(name);
      error.name = name;
      mockSend.mockRejectedValueOnce(error);

      const provider = new BedrockProvider();
      await expect(provider.analyze(makeCluster(), [])).rejects.toThrow(name);
    });
  }
});
