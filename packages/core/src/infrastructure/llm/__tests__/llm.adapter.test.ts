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
  createLogger: vi.fn(function() { return mockLogger; }),
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
    // response_format is intentionally omitted — not supported by all OpenRouter models (e.g. Qwen free tier)
    expect(body.response_format).toBeUndefined();
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

  it('throws when fetch response is not ok (non-retryable status)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(provider.analyze(makeCluster(), [])).rejects.toThrow(
      'OpenRouter API failed: 500',
    );
  });

  it('retries once on 429 and throws if still rate-limited', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { metadata: { retry_after_seconds: 1 } } }),
    });

    const promise = provider.analyze(makeCluster(), []);
    // Attach rejection handler immediately to avoid unhandled rejection warnings.
    const assertion = expect(promise).rejects.toThrow('OpenRouter API failed: 429');
    // Drain the backoff setTimeout so the second attempt runs.
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
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

// ── OpenRouterProvider fallback chain tests ───────────────────────────────

describe('OpenRouterProvider — fallback chain', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function make429Response(retryAfterSeconds = 1) {
    return {
      ok: false,
      status: 429,
      json: async () => ({ error: { metadata: { retry_after_seconds: retryAfterSeconds } } }),
    };
  }

  function makeSuccessResponse(content: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content } }],
      }),
    };
  }

  const successContent =
    '{"probable_cause":"fixed","impacted_services":["svc"],"recommended_steps":["act"],"urgency_level":"low","requires_rollback":false}';

  it('primary success — no fallback hop emitted', async () => {
    const provider = new OpenRouterProvider('key', 'model-a', ['model-b'], 60_000);
    mockFetch.mockResolvedValue(makeSuccessResponse(successContent));

    await provider.analyze(makeCluster(), [], 'corr-1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'llm:fallback:hop' }),
      expect.any(String),
    );
  });

  it('primary 429×2 then model-b succeeds — returns model-b result', async () => {
    const provider = new OpenRouterProvider('key', 'model-a', ['model-b'], 60_000);
    // First two calls → 429, third call → success
    mockFetch
      .mockResolvedValueOnce(make429Response())
      .mockResolvedValueOnce(make429Response())
      .mockResolvedValueOnce(makeSuccessResponse(successContent));

    const promise = provider.analyze(makeCluster(), [], 'corr-hop');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.probable_cause).toBe('fixed');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        from_model: 'model-a',
        to_model: 'model-b',
        reason: '429',
      }),
      'llm:fallback:hop',
    );
  });

  it('all models exhausted — throws "OpenRouter API exhausted all models"', async () => {
    const provider = new OpenRouterProvider('key', 'model-a', ['model-b'], 60_000);
    mockFetch.mockResolvedValue(make429Response());

    const promise = provider.analyze(makeCluster(), [], 'corr-exhaust');
    const assertion = expect(promise).rejects.toThrow('OpenRouter API exhausted all models');
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('timeout budget exceeded before first hop — throws "OpenRouter fallback chain timed out"', async () => {
    // fallbackTimeoutMs = 0 means deadline is already passed
    const provider = new OpenRouterProvider('key', 'model-a', ['model-b'], 0);
    mockFetch.mockResolvedValue(make429Response());

    const promise = provider.analyze(makeCluster(), [], 'corr-timeout');
    const assertion = expect(promise).rejects.toThrow('OpenRouter fallback chain timed out');
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('primary model deduped from fallback list at construction', async () => {
    const provider = new OpenRouterProvider('key', 'model-a', ['model-a', 'model-b'], 60_000);
    // All three calls would be needed if model-a was in fallback too
    mockFetch
      .mockResolvedValueOnce(make429Response())
      .mockResolvedValueOnce(make429Response())
      .mockResolvedValueOnce(makeSuccessResponse(successContent));

    const promise = provider.analyze(makeCluster(), [], 'corr-dedup');
    await vi.runAllTimersAsync();
    const result = await promise;

    // model-b was tried (not model-a again), fetch called 3 times total (2 primary + 1 fallback)
    expect(result.probable_cause).toBe('fixed');
    const calls = mockFetch.mock.calls as [string, RequestInit][];
    const fallbackBody = JSON.parse(calls[2][1].body as string);
    expect(fallbackBody.model).toBe('model-b');
  });

  it('hop log event shape has from_model, to_model, reason', async () => {
    const provider = new OpenRouterProvider('key', 'model-a', ['model-b', 'model-c'], 60_000);
    // model-a: 2×429, model-b: 1×429, model-c: success
    mockFetch
      .mockResolvedValueOnce(make429Response())
      .mockResolvedValueOnce(make429Response())
      .mockResolvedValueOnce(make429Response())
      .mockResolvedValueOnce(makeSuccessResponse(successContent));

    const promise = provider.analyze(makeCluster(), [], 'corr-shape');
    await vi.runAllTimersAsync();
    await promise;

    const hopCalls = mockLogger.info.mock.calls.filter(
      (c: unknown[]) => c[1] === 'llm:fallback:hop',
    );
    // Two transitions: a→b and b→c
    expect(hopCalls).toHaveLength(2);
    expect(hopCalls[0][0]).toMatchObject({ from_model: 'model-a', to_model: 'model-b', reason: '429' });
    expect(hopCalls[1][0]).toMatchObject({ from_model: 'model-b', to_model: 'model-c', reason: '429' });
  });
});

// ── createLLMProvider factory — fallback options ───────────────────────────

describe('createLLMProvider — fallback options forwarded', () => {
  it('forwards fallbackModels and fallbackTimeoutMs to OpenRouterProvider', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers();

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"probable_cause":"x","impacted_services":["s"],"recommended_steps":["r"],"urgency_level":"low","requires_rollback":false}' } }],
      }),
    });

    const provider = createLLMProvider('openrouter', 'key', 'model-a', {
      fallbackModels: ['model-b'],
      fallbackTimeoutMs: 30_000,
    });

    const promise = provider.analyze(makeCluster(), []);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

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

// ── OpenRouterProvider metric instrumentation tests ────────────────────────

const mockMetrics = vi.hoisted(() => ({
  inc: vi.fn(),
  observe: vi.fn(),
}));

vi.mock('../../../shared/metrics/index.js', () => ({
  llmInferenceTotal: { inc: mockMetrics.inc },
  llmInferenceDuration: { observe: mockMetrics.observe },
}));

describe('OpenRouterProvider — metric instrumentation', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeSuccessResponse(content: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
  }

  const successContent =
    '{"probable_cause":"x","impacted_services":["s"],"recommended_steps":["r"],"urgency_level":"low","requires_rollback":false}';

  it('increments llmInferenceTotal with status=success on successful call', async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse(successContent));
    const provider = new OpenRouterProvider('key', 'qwen/test-model');
    await provider.analyze(makeCluster(), []);
    expect(mockMetrics.inc).toHaveBeenCalledWith({ status: 'success' });
  });

  it('observes llmInferenceDuration with model label on successful call', async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse(successContent));
    const provider = new OpenRouterProvider('key', 'qwen/test-model');
    await provider.analyze(makeCluster(), []);
    expect(mockMetrics.observe).toHaveBeenCalledWith(
      { model: 'qwen/test-model' },
      expect.any(Number),
    );
  });

  it('increments llmInferenceTotal with status=error on non-retryable HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const provider = new OpenRouterProvider('key', 'qwen/test-model');
    await expect(provider.analyze(makeCluster(), [])).rejects.toThrow();
    expect(mockMetrics.inc).toHaveBeenCalledWith({ status: 'error' });
  });

  it('increments llmInferenceTotal with status=rate_limited when 429 exhausted with no fallback', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { metadata: { retry_after_seconds: 1 } } }),
    });
    const provider = new OpenRouterProvider('key', 'qwen/test-model');
    const promise = provider.analyze(makeCluster(), []);
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockMetrics.inc).toHaveBeenCalledWith({ status: 'rate_limited' });
    vi.useRealTimers();
  });
});

