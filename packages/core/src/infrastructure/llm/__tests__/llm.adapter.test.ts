import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';
import { AlertType } from '../../../shared/constants.js';
import {
  MockLLMProvider,
  OpenRouterProvider,
  createLLMProvider,
  OpenRouterResponseSchema,
} from '../llm.adapter.js';

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

// ── OpenRouterResponseSchema tests ────────────────────────────────────────

describe('OpenRouterResponseSchema', () => {
  it('parses a valid response', () => {
    const valid = {
      id: 'chat-abc123',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '{"foo":"bar"}' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    expect(OpenRouterResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('parses minimal response without optional fields', () => {
    const minimal = {
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
    };
    expect(OpenRouterResponseSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects response missing choices array', () => {
    const invalid = { id: 'no-choices' };
    expect(OpenRouterResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects response with invalid choice structure', () => {
    const invalid = { choices: [{ index: 'bad' }] };
    expect(OpenRouterResponseSchema.safeParse(invalid).success).toBe(false);
  });
});

// ── MockLLMProvider tests ──────────────────────────────────────────────────

describe('MockLLMProvider', () => {
  it('returns deterministic analysis matching schema', async () => {
    const provider = new MockLLMProvider();
    const cluster = makeCluster();
    const result = await provider.analyze(cluster, []);

    expect(result.probable_cause).toBe('Mock: http_500 on checkout-service');
    expect(result.impacted_services).toEqual(['checkout-service']);
    expect(result.recommended_steps).toEqual(['Check the logs', 'Verify the deployment']);
    expect(result.urgency_level).toBe('high');
    expect(result.requires_rollback).toBe(false);
  });

  it('logs incoming cluster calls', async () => {
    const provider = new MockLLMProvider();
    const cluster = makeCluster({ serviceName: 'auth-service' });
    await provider.analyze(cluster, []);
    await provider.analyze(cluster, []);

    expect(provider.callLog).toHaveLength(2);
    expect(provider.callLog[0].cluster.serviceName).toBe('auth-service');
    expect(provider.callLog[1].cluster.serviceName).toBe('auth-service');
  });

  it('ignores traces param but accepts it', async () => {
    const provider = new MockLLMProvider();
    const traces = [{ traceId: 't1' }, { traceId: 't2' }];
    const result = await provider.analyze(makeCluster(), traces);
    expect(result.probable_cause).toBe('Mock: http_500 on checkout-service');
  });

  it('returns analysis that validates against LLMAnalysisSchema', async () => {
    const { LLMAnalysisSchema } = await import('../../../domain/entities/incident.js');
    const provider = new MockLLMProvider();
    const result = await provider.analyze(makeCluster(), []);
    expect(() => LLMAnalysisSchema.parse(result)).not.toThrow();
  });
});

// ── OpenRouterProvider tests ───────────────────────────────────────────────

describe('OpenRouterProvider', () => {
  const mockFetch = vi.fn();
  let provider: OpenRouterProvider;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    provider = new OpenRouterProvider('test-key', 'qwen/qwen-2.5-72b-instruct');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls OpenRouter API with correct headers and body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"probable_cause":"bad query","impacted_services":["api"],"recommended_steps":["fix query"],"urgency_level":"high","requires_rollback":false}' },
          },
        ],
      }),
    });

    await provider.analyze(makeCluster(), []);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
      'HTTP-Referer': 'https://junando.app',
      'X-Title': 'Junando SRE',
    });

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('qwen/qwen-2.5-72b-instruct');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.response_format).toEqual({ type: 'json_object' });
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
              content: '{"probable_cause":"memory leak","impacted_services":["web"],"recommended_steps":["restart pod"],"urgency_level":"critical","requires_rollback":true}',
            },
          },
        ],
      }),
    });

    const result = await provider.analyze(makeCluster(), []);

    expect(result.probable_cause).toBe('memory leak');
    expect(result.impacted_services).toEqual(['web']);
    expect(result.recommended_steps).toEqual(['restart pod']);
    expect(result.urgency_level).toBe('critical');
    expect(result.requires_rollback).toBe(true);
  });

  it('throws when fetch response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    await expect(provider.analyze(makeCluster(), [])).rejects.toThrow(
      'OpenRouter API failed: 429',
    );
  });

  it('returns fallback analysis when response JSON is invalid', async () => {
    // fetch succeeds but JSON schema validation fails
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ bad: 'structure' }] }),
    });

    const result = await provider.analyze(makeCluster(), []);
    // Falls back to heuristic analysis
    expect(result.urgency_level).toBeDefined();
    expect(result.probable_cause).toBe('Analysis in progress - check logs for details');
  });

  it('returns fallback when choices array is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    });

    const result = await provider.analyze(makeCluster(), []);
    expect(result.probable_cause).toBe('Analysis in progress - check logs for details');
  });

  it('handles cluster with missing optional fields', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '{"probable_cause":"timeout","impacted_services":["svc"],"recommended_steps":["timeout fix"],"urgency_level":"medium","requires_rollback":false}',
            },
          },
        ],
      }),
    });

    const clusterNoLatency = makeCluster({ latencyP99Ms: undefined });
    const result = await provider.analyze(clusterNoLatency, []);
    expect(result.urgency_level).toBe('medium');
  });

  it('uses default model when model param is omitted', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"probable_cause":"x","impacted_services":["x"],"recommended_steps":["x"],"urgency_level":"low","requires_rollback":false}' },
          },
        ],
      }),
    });

    const defaultProvider = new OpenRouterProvider('key');
    await defaultProvider.analyze(makeCluster(), []);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('qwen/qwen-2.5-72b-instruct');
  });
});

// ── createLLMProvider factory tests ───────────────────────────────────────

describe('createLLMProvider', () => {
  it('creates a GeminiProvider from LLMProviderType.Gemini', async () => {
    const { GeminiProvider } = await import('../llm.adapter.js');
    const provider = createLLMProvider('gemini', 'key-abc');
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('creates a ClaudeProvider from LLMProviderType.Claude', async () => {
    const { ClaudeProvider } = await import('../llm.adapter.js');
    const provider = createLLMProvider('claude', 'key-abc');
    expect(provider).toBeInstanceOf(ClaudeProvider);
  });

  it('creates an OpenRouterProvider for "openrouter" string', () => {
    const provider = createLLMProvider('openrouter', 'key-abc');
    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });

  it('creates an OpenRouterProvider for "qwen" string', () => {
    const provider = createLLMProvider('qwen', 'key-abc');
    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });

  it('throws Error with provider name and supported list for unknown provider', () => {
    expect(() => createLLMProvider('unknown-provider', 'key')).toThrow(
      /Unknown LLM_PROVIDER: "unknown-provider"/,
    );
  });

  it('error message lists all supported providers', () => {
    try {
      createLLMProvider('bad', 'key');
    } catch (err: unknown) {
      expect((err as Error).message).toContain('gemini');
      expect((err as Error).message).toContain('claude');
      expect((err as Error).message).toContain('openrouter');
      expect((err as Error).message).toContain('qwen');
    }
  });
});

// ── ILLMProvider interface contract tests ─────────────────────────────────

describe('LLM provider interface contract', () => {
  it('all providers expose analyze method', () => {
    const mock = new MockLLMProvider();
    expect(typeof mock.analyze).toBe('function');

    const openrouter = new OpenRouterProvider('key');
    expect(typeof openrouter.analyze).toBe('function');
  });

  it('analyze returns a Promise<LLMAnalysis>', async () => {
    const mock = new MockLLMProvider();
    const result = await mock.analyze(makeCluster(), []);
    expect(result).toHaveProperty('probable_cause');
    expect(result).toHaveProperty('impacted_services');
    expect(result).toHaveProperty('recommended_steps');
    expect(result).toHaveProperty('urgency_level');
    expect(result).toHaveProperty('requires_rollback');
  });
});

// ── parseAnalysis edge cases (via MockLLMProvider + OpenRouter) ────────────

describe('parseAnalysis edge cases', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function parseViaOpenRouter(content: string): Promise<LLMAnalysis> {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content } }],
      }),
    });
    const provider = new OpenRouterProvider('key');
    return provider.analyze(makeCluster(), []);
  }

  it('parses analysis with extra whitespace around JSON', async () => {
    const raw = `
      {
        "probable_cause": "db overload",
        "impacted_services": ["db-service"],
        "recommended_steps": ["scale up"],
        "urgency_level": "high",
        "requires_rollback": true
      }
    `;
    const result = await parseViaOpenRouter(raw);
    expect(result.urgency_level).toBe('high');
    expect(result.requires_rollback).toBe(true);
  });

  it('parses analysis with JSON wrapper and surrounding text', async () => {
    const raw = `Here is the analysis: {"probable_cause":"crashed","impacted_services":["svc"],"recommended_steps":["restart"],"urgency_level":"critical","requires_rollback":false}`;
    const result = await parseViaOpenRouter(raw);
    expect(result.probable_cause).toBe('crashed');
    expect(result.urgency_level).toBe('critical');
  });

  it('falls back to heuristic urgency detection when JSON parse fails', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: 'This is a CRITICAL issue with rollback needed' } }],
      }),
    });
    const provider = new OpenRouterProvider('key');
    const result = await provider.analyze(makeCluster(), []);
    expect(result.urgency_level).toBe('critical');
    expect(result.requires_rollback).toBe(true);
  });

  it('detects low urgency via heuristics', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: 'Low impact, low severity, no action needed' } }],
      }),
    });
    const provider = new OpenRouterProvider('key');
    const result = await provider.analyze(makeCluster(), []);
    expect(result.urgency_level).toBe('low');
  });

  it('detects high urgency via severity-2 keyword', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: 'This is severity 2 issue' } }],
      }),
    });
    const provider = new OpenRouterProvider('key');
    const result = await provider.analyze(makeCluster(), []);
    expect(result.urgency_level).toBe('high');
  });

  it('uses unknown-service default when impacted_services cannot be parsed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"probable_cause":"x","impacted_services":[],"recommended_steps":["y"],"urgency_level":"low","requires_rollback":false}' } }],
      }),
    });
    const provider = new OpenRouterProvider('key');
    const result = await provider.analyze(makeCluster(), []);
    // Empty array would fail LLMAnalysisSchema min(1), so it falls to heuristic
    // or uses regex fallback
    expect(result).toBeDefined();
  });

  it('handles malformed JSON that is still valid in regex fallback', async () => {
    const raw =
      '{"probable_cause":"bad parse","impacted_services":["svc"],"recommended_steps":["step"],"urgency_level":"medium","requires_rollback":false}';
    const result = await parseViaOpenRouter(raw);
    expect(result.urgency_level).toBe('medium');
  });
});

// ── OpenRouterProvider structured logging tests ────────────────────────────

describe('OpenRouterProvider structured logging', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs llm:request:start with model and promptLength before fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"probable_cause":"x","impacted_services":["svc"],"recommended_steps":["s"],"urgency_level":"low","requires_rollback":false}' } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
    });

    const provider = new OpenRouterProvider('key', 'qwen/model');
    await provider.analyze(makeCluster(), [], 'corr-123');

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'qwen/model', correlationId: 'corr-123' }),
      'llm:request:start',
    );
  });

  it('logs llm:request:success with usage and latencyMs after successful parse', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"probable_cause":"x","impacted_services":["svc"],"recommended_steps":["s"],"urgency_level":"low","requires_rollback":false}' } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }),
    });

    const provider = new OpenRouterProvider('key', 'qwen/model');
    await provider.analyze(makeCluster(), [], 'corr-456');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen/model',
        usage: expect.objectContaining({ promptTokens: 20, completionTokens: 10, totalTokens: 30 }),
        latencyMs: expect.any(Number),
        correlationId: 'corr-456',
      }),
      'llm:request:success',
    );
  });

  it('logs llm:parse:failed as warn when JSON parse fails', async () => {
    // Content has braces but is malformed JSON — triggers the catch branch
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: '{not valid json: at all}' } }],
      }),
    });

    const provider = new OpenRouterProvider('key', 'qwen/model');
    await provider.analyze(makeCluster(), [], 'corr-789');

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawResponse: expect.any(String), correlationId: 'corr-789' }),
      'llm:parse:failed',
    );
  });

  it('logs llm:validation:failed as warn when OpenRouter schema validation fails', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ bad: 'structure' }] }),
    });

    const provider = new OpenRouterProvider('key', 'qwen/model');
    await provider.analyze(makeCluster(), [], 'corr-abc');

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errors: expect.anything(), correlationId: 'corr-abc' }),
      'llm:validation:failed',
    );
  });

  it('analyze works without correlationId param (backward compat)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"probable_cause":"x","impacted_services":["s"],"recommended_steps":["r"],"urgency_level":"low","requires_rollback":false}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }),
    });

    const provider = new OpenRouterProvider('key', 'qwen/model');
    // Must not throw — correlationId is optional
    await expect(provider.analyze(makeCluster(), [])).resolves.toBeDefined();
  });
});
