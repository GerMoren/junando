import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockSend = vi.hoisted(() => vi.fn());
const mockSSMClient = {
  send: mockSend,
};

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => mockSSMClient),
  GetParametersCommand: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const validConfig = {
  LLM_PROVIDER: 'gemini',
  LLM_API_KEY: 'test-api-key',
  LLM_MODEL: 'gemini-2.0-flash',
  SLACK_BOT_TOKEN: 'xoxb-1234567890123-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx',
  SLACK_SIGNING_SECRET: 'signing-secret-123',
  SLACK_CHANNEL: '#alerts',
  LOKI_URL: 'http://localhost:3100/loki/api/v1/push',
  REDIS_URL: 'redis://localhost:6379',
  SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
  DEDUP_TTL_SECONDS: '600',
  CLUSTER_WINDOW_MS: '60000',
  LOG_LEVEL: 'debug',
  NODE_ENV: 'production',
};

function setEnv(vars: Partial<typeof validConfig>) {
  Object.entries(vars).forEach(([k, v]) => {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  });
}

function clearEnv() {
  Object.keys(validConfig).forEach((k) => delete process.env[k]);
  delete process.env.SSM_PREFIX;
  delete process.env.NOTIFIER_TYPE;
  delete process.env.TEAMS_WEBHOOK_URL;
  delete process.env.LLM_FALLBACK_MODELS;
  delete process.env.LLM_FALLBACK_TIMEOUT_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Config — loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  // ── Schema: llmProvider ──────────────────────────────────────────────────

  describe('llmProvider validation (enum)', () => {
    for (const provider of ['gemini', 'claude', 'openrouter', 'qwen']) {
      it(`accepts "${provider}"`, async () => {
        setEnv({ ...validConfig, LLM_PROVIDER: provider });
        const config = await loadConfig();
        expect(config.llmProvider).toBe(provider);
      });
    }

    for (const invalid of ['openai', 'anthropic', 'gpt-4', '']) {
      it(`rejects invalid provider "${invalid}"`, async () => {
        setEnv({ ...validConfig, LLM_PROVIDER: invalid });
        await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
      });
    }
  });

  // ── Schema: llmApiKey ───────────────────────────────────────────────────

  describe('llmApiKey validation (string min 1)', () => {
    it('accepts non-empty string', async () => {
      setEnv({ ...validConfig, LLM_API_KEY: 'sk-abc123' });
      const config = await loadConfig();
      expect(config.llmApiKey).toBe('sk-abc123');
    });

    it('rejects empty string', async () => {
      setEnv({ ...validConfig, LLM_API_KEY: '' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });

    it('rejects missing value', async () => {
      setEnv({ ...validConfig, LLM_API_KEY: undefined });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── Schema: slackBotToken ───────────────────────────────────────────────

  describe('slackBotToken validation (starts with xoxb-)', () => {
    it('accepts token with xoxb- prefix', async () => {
      setEnv({ ...validConfig, SLACK_BOT_TOKEN: 'xoxb-abc' });
      const config = await loadConfig();
      expect(config.slackBotToken).toBe('xoxb-abc');
    });

    it('rejects token without xoxb- prefix', async () => {
      setEnv({ ...validConfig, SLACK_BOT_TOKEN: 'bearer-token' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });

    it('rejects empty string', async () => {
      setEnv({ ...validConfig, SLACK_BOT_TOKEN: '' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── Schema: slackSigningSecret ──────────────────────────────────────────

  describe('slackSigningSecret validation', () => {
    it('accepts non-empty string', async () => {
      setEnv({ ...validConfig, SLACK_SIGNING_SECRET: 'sig123' });
      const config = await loadConfig();
      expect(config.slackSigningSecret).toBe('sig123');
    });

    it('rejects empty string', async () => {
      setEnv({ ...validConfig, SLACK_SIGNING_SECRET: '' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── Schema: slackChannel ────────────────────────────────────────────────

  describe('slackChannel validation (starts with #)', () => {
    it('accepts channel with # prefix', async () => {
      setEnv({ ...validConfig, SLACK_CHANNEL: '#ops-alerts' });
      const config = await loadConfig();
      expect(config.slackChannel).toBe('#ops-alerts');
    });

    it('rejects channel without # prefix', async () => {
      setEnv({ ...validConfig, SLACK_CHANNEL: 'ops-alerts' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── Schema: lokiUrl ─────────────────────────────────────────────────────

  describe('lokiUrl validation (valid URL)', () => {
    it('accepts valid HTTP URL', async () => {
      setEnv({ ...validConfig, LOKI_URL: 'http://loki:3100/loki/api/v1/push' });
      const config = await loadConfig();
      expect(config.lokiUrl).toBe('http://loki:3100/loki/api/v1/push');
    });

    it('accepts valid HTTPS URL', async () => {
      setEnv({ ...validConfig, LOKI_URL: 'https://loki.example.com/loki/api/v1/push' });
      const config = await loadConfig();
      expect(config.lokiUrl).toBe('https://loki.example.com/loki/api/v1/push');
    });

    it('accepts URLs with embedded credentials (Grafana Cloud format)', async () => {
      setEnv({ ...validConfig, LOKI_URL: 'https://user:token@logs-prod-024.grafana.net/loki/api/v1/push' });
      const config = await loadConfig();
      expect(config.lokiUrl).toContain('grafana.net');
    });

    it('coerces empty LOKI_URL to undefined (env var present but empty)', async () => {
      setEnv({ ...validConfig, LOKI_URL: '' });
      const config = await loadConfig();
      expect(config.lokiUrl).toBeUndefined();
    });

    it('coerces empty string to undefined (compose env_file passthrough)', async () => {
      setEnv({ ...validConfig, LOKI_URL: '' });
      const config = await loadConfig();
      expect(config.lokiUrl).toBeUndefined();
    });

    it('succeeds when LOKI_URL is absent (optional)', async () => {
      const env = { ...validConfig };
      delete (env as any).LOKI_URL;
      setEnv(env);
      const config = await loadConfig();
      expect(config.lokiUrl).toBeUndefined();
    });

    it('succeeds when LOKI_URL is undefined explicitly', async () => {
      setEnv({ ...validConfig, LOKI_URL: undefined });
      const config = await loadConfig();
      expect(config.lokiUrl).toBeUndefined();
    });
  });

  // ── Schema: redisUrl ─────────────────────────────────────────────────────

  describe('redisUrl validation (valid URL)', () => {
    it('accepts redis:// URL', async () => {
      setEnv({ ...validConfig, REDIS_URL: 'redis://localhost:6379' });
      const config = await loadConfig();
      expect(config.redisUrl).toBe('redis://localhost:6379');
    });

    it('accepts rediss:// URL for TLS', async () => {
      setEnv({ ...validConfig, REDIS_URL: 'rediss://redis.example.com:6379' });
      const config = await loadConfig();
      expect(config.redisUrl).toBe('rediss://redis.example.com:6379');
    });

    it('rejects invalid URL', async () => {
      setEnv({ ...validConfig, REDIS_URL: 'not-a-url-at-all' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── Schema: optional fields ─────────────────────────────────────────────

  describe('optional fields', () => {
    it('uses defaults when llmModel is omitted', async () => {
      setEnv({ ...validConfig, LLM_MODEL: undefined });
      const config = await loadConfig();
      expect(config.llmModel).toBeUndefined();
    });

    it('accepts custom llmModel', async () => {
      setEnv({ ...validConfig, LLM_MODEL: 'gemini-2.5-pro' });
      const config = await loadConfig();
      expect(config.llmModel).toBe('gemini-2.5-pro');
    });

    it('uses default dedupTtlSeconds (300)', async () => {
      setEnv({ ...validConfig, DEDUP_TTL_SECONDS: undefined });
      const config = await loadConfig();
      expect(config.dedupTtlSeconds).toBe(300);
    });

    it('accepts custom dedupTtlSeconds', async () => {
      setEnv({ ...validConfig, DEDUP_TTL_SECONDS: '120' });
      const config = await loadConfig();
      expect(config.dedupTtlSeconds).toBe(120);
    });

    it('uses default clusterWindowMs (120000)', async () => {
      setEnv({ ...validConfig, CLUSTER_WINDOW_MS: undefined });
      const config = await loadConfig();
      expect(config.clusterWindowMs).toBe(120_000);
    });

    it('accepts custom clusterWindowMs', async () => {
      setEnv({ ...validConfig, CLUSTER_WINDOW_MS: '60000' });
      const config = await loadConfig();
      expect(config.clusterWindowMs).toBe(60_000);
    });

    it('uses default logLevel (info)', async () => {
      setEnv({ ...validConfig, LOG_LEVEL: undefined });
      const config = await loadConfig();
      expect(config.logLevel).toBe('info');
    });

    for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
      it(`accepts logLevel "${level}"`, async () => {
        setEnv({ ...validConfig, LOG_LEVEL: level });
        const config = await loadConfig();
        expect(config.logLevel).toBe(level);
      });
    }

    it('rejects invalid logLevel', async () => {
      setEnv({ ...validConfig, LOG_LEVEL: 'verbose' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });

    it('uses default nodeEnv (development)', async () => {
      setEnv({ ...validConfig, NODE_ENV: undefined });
      const config = await loadConfig();
      expect(config.nodeEnv).toBe('development');
    });

    for (const env of ['development', 'test', 'production']) {
      it(`accepts nodeEnv "${env}"`, async () => {
        setEnv({ ...validConfig, NODE_ENV: env });
        const config = await loadConfig();
        expect(config.nodeEnv).toBe(env);
      });
    }

    it('accepts empty string for sqsQueueUrl (optional)', async () => {
      setEnv({ ...validConfig, SQS_QUEUE_URL: '' });
      const config = await loadConfig();
      expect(config.sqsQueueUrl).toBe('');
    });

    it('accepts valid SQS URL', async () => {
      setEnv({ ...validConfig, SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789/test' });
      const config = await loadConfig();
      expect(config.sqsQueueUrl).toBe('https://sqs.us-east-1.amazonaws.com/123456789/test');
    });

    it('rejects invalid SQS URL', async () => {
      setEnv({ ...validConfig, SQS_QUEUE_URL: 'not-a-url' });
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── SSM loading ─────────────────────────────────────────────────────────

  describe('loadSecretsFromSSM integration', () => {
    it('skips SSM loading when SSM_PREFIX is not set', async () => {
      setEnv(validConfig);
      await loadConfig();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('maps SSM parameters to environment variables', async () => {
      mockSend.mockResolvedValueOnce({
        Parameters: [
          { Name: '/junando/llm-provider', Value: 'claude' },
          { Name: '/junando/llm-api-key', Value: 'sk-from-ssm' },
          { Name: '/junando/slack-bot-token', Value: 'xoxb-ssm-token' },
          { Name: '/junando/slack-signing-secret', Value: 'ssm-signing-secret' },
          { Name: '/junando/slack-channel', Value: '#ssm-alerts' },
          { Name: '/junando/loki-url', Value: 'http://loki:3100' },
          { Name: '/junando/redis-url', Value: 'redis://redis:6379' },
          { Name: '/junando/llm-model', Value: 'claude-sonnet-4' },
        ],
      });

      // Only set SSM_PREFIX, the rest come from SSM
      process.env.SSM_PREFIX = '/junando';
      delete process.env.LLM_PROVIDER;
      delete process.env.LLM_API_KEY;
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_SIGNING_SECRET;
      delete process.env.SLACK_CHANNEL;
      delete process.env.LOKI_URL;
      delete process.env.REDIS_URL;
      delete process.env.LLM_MODEL;

      const config = await loadConfig();

      expect(config.llmProvider).toBe('claude');
      expect(config.llmApiKey).toBe('sk-from-ssm');
      expect(config.slackBotToken).toBe('xoxb-ssm-token');
      expect(config.slackSigningSecret).toBe('ssm-signing-secret');
      expect(config.slackChannel).toBe('#ssm-alerts');
      expect(config.lokiUrl).toBe('http://loki:3100');
      expect(config.redisUrl).toBe('redis://redis:6379');
      expect(config.llmModel).toBe('claude-sonnet-4');
    });

    it('SSM values override existing env vars', async () => {
      mockSend.mockResolvedValueOnce({
        Parameters: [
          { Name: '/junando/llm-provider', Value: 'qwen' },
          { Name: '/junando/llm-api-key', Value: 'ssm-key' },
          { Name: '/junando/slack-bot-token', Value: 'xoxb-ssm' },
          { Name: '/junando/slack-signing-secret', Value: 'ssm-sig' },
          { Name: '/junando/slack-channel', Value: '#override' },
          { Name: '/junando/loki-url', Value: 'http://ssm-loki:3100' },
          { Name: '/junando/redis-url', Value: 'redis://ssm-redis:6379' },
        ],
      });

      process.env.SSM_PREFIX = '/junando';

      // Set env vars that SSM should override
      process.env.LLM_PROVIDER = 'gemini';
      process.env.LLM_API_KEY = 'env-key';
      process.env.SLACK_BOT_TOKEN = 'xoxb-env';
      process.env.SLACK_SIGNING_SECRET = 'env-sig';
      process.env.SLACK_CHANNEL = '#env-channel';
      process.env.LOKI_URL = 'http://env-loki:3100';
      process.env.REDIS_URL = 'redis://env-redis:6379';

      const config = await loadConfig();

      // SSM values should win
      expect(config.llmProvider).toBe('qwen');
      expect(config.llmApiKey).toBe('ssm-key');
      expect(config.slackChannel).toBe('#override');
    });

// SSM unavailable: silence console.error (expected behavior in this test)
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('silently continues if SSM fetch fails (catches error)', async () => {
    mockSend.mockRejectedValueOnce(new Error('SSM unavailable'));

      // Provide valid env vars so config still loads
      setEnv(validConfig);
      process.env.SSM_PREFIX = '/junando';

      // Should not throw — error is caught and logged
      const config = await loadConfig();
      expect(config.llmProvider).toBe('gemini');
    });

    it('ignores parameters with empty Name or Value', async () => {
      mockSend.mockResolvedValueOnce({
        Parameters: [
          { Name: '/junando/llm-provider', Value: 'gemini' },
          { Name: '', Value: 'should-ignore' },
          { Name: '/junando/llm-api-key', Value: '' },
        ],
      });

      process.env.SSM_PREFIX = '/junando';
      delete process.env.LLM_API_KEY;
      delete process.env.LLM_PROVIDER;

      // Should fail because llm-api-key is empty string from SSM
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── Schema: llmFallbackModels ───────────────────────────────────────────

  describe('llmFallbackModels (comma-separated string → string[])', () => {
    it('defaults to empty array when LLM_FALLBACK_MODELS is unset', async () => {
      setEnv({ ...validConfig });
      delete process.env['LLM_FALLBACK_MODELS'];
      const config = await loadConfig();
      expect(config.llmFallbackModels).toEqual([
        'google/gemma-4-31b-it:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'mistralai/mistral-7b-instruct:free',
      ]);
    });

    it('parses a comma-separated list of models', async () => {
      setEnv({ ...validConfig });
      process.env['LLM_FALLBACK_MODELS'] = 'model-b,model-c';
      const config = await loadConfig();
      expect(config.llmFallbackModels).toEqual(['model-b', 'model-c']);
    });

    it('trims whitespace from model names', async () => {
      setEnv({ ...validConfig });
      process.env['LLM_FALLBACK_MODELS'] = ' model-b , model-c ';
      const config = await loadConfig();
      expect(config.llmFallbackModels).toEqual(['model-b', 'model-c']);
    });

    it('returns empty array when LLM_FALLBACK_MODELS is empty string', async () => {
      setEnv({ ...validConfig });
      process.env['LLM_FALLBACK_MODELS'] = '';
      const config = await loadConfig();
      expect(config.llmFallbackModels).toEqual([]);
    });
  });

  // ── Schema: llmFallbackTimeoutMs ─────────────────────────────────────────

  describe('llmFallbackTimeoutMs (number with default)', () => {
    it('defaults to 60000 when LLM_FALLBACK_TIMEOUT_MS is unset', async () => {
      setEnv({ ...validConfig });
      delete process.env['LLM_FALLBACK_TIMEOUT_MS'];
      const config = await loadConfig();
      expect(config.llmFallbackTimeoutMs).toBe(60_000);
    });

    it('coerces string "45000" to number 45000', async () => {
      setEnv({ ...validConfig });
      process.env['LLM_FALLBACK_TIMEOUT_MS'] = '45000';
      const config = await loadConfig();
      expect(config.llmFallbackTimeoutMs).toBe(45_000);
    });

    it('rejects zero value (must be positive)', async () => {
      setEnv({ ...validConfig });
      process.env['LLM_FALLBACK_TIMEOUT_MS'] = '0';
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  // ── Error messages ──────────────────────────────────────────────────────

  describe('error messages are descriptive', () => {
    it('lists all validation errors on failure', async () => {
      // Provide no env vars — expect multiple errors
      try {
        await loadConfig();
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('llmProvider');
        expect(err.message).toContain('llmApiKey');
      }
    });
  });

  // ── Notifier discriminated union (CFG-01..06) ────────────────────────────

  describe('CFG-02: missing NOTIFIER_TYPE defaults to slack', () => {
    it('defaults notifierType to slack when NOTIFIER_TYPE is absent', async () => {
      setEnv({ ...validConfig });
      const config = await loadConfig();
      expect(config.notifierType).toBe('slack');
    });
  });

  describe('CFG-01: NOTIFIER_TYPE enum validation', () => {
    it('accepts NOTIFIER_TYPE=teams', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      process.env['TEAMS_WEBHOOK_URL'] = 'https://prod.example.powerautomate.com/invoke?api-version=1';
      const config = await loadConfig();
      expect(config.notifierType).toBe('teams');
    });

    it('accepts NOTIFIER_TYPE=slack with valid slack vars', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'slack';
      const config = await loadConfig();
      expect(config.notifierType).toBe('slack');
    });

    it('rejects NOTIFIER_TYPE=discord with validation error', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'discord';
      await expect(loadConfig()).rejects.toThrow(/Invalid configuration/);
    });
  });

  describe('CFG-03: slack requires token and channel', () => {
    it('rejects slack without SLACK_BOT_TOKEN', async () => {
      setEnv({ ...validConfig, SLACK_BOT_TOKEN: undefined });
      process.env['NOTIFIER_TYPE'] = 'slack';
      await expect(loadConfig()).rejects.toThrow(/SLACK_BOT_TOKEN/);
    });

    it('rejects slack with invalid token prefix (not xoxb-)', async () => {
      setEnv({ ...validConfig, SLACK_BOT_TOKEN: 'xoxa-bad' });
      process.env['NOTIFIER_TYPE'] = 'slack';
      await expect(loadConfig()).rejects.toThrow(/xoxb-/);
    });

    it('rejects slack without SLACK_CHANNEL', async () => {
      setEnv({ ...validConfig, SLACK_CHANNEL: undefined });
      process.env['NOTIFIER_TYPE'] = 'slack';
      await expect(loadConfig()).rejects.toThrow(/SLACK_CHANNEL/);
    });

    // CFG-03: regression — slackSigningSecret must be required when notifierType=slack.
    // Pre-PR #39 it was schema-required; PR #39 made it optional and superRefine
    // forgot to enforce it, causing HTTP 500 in handler.ts when createHmac receives
    // undefined. See issue #41.
    it('CFG-03: slack notifierType without slackSigningSecret fails validation', async () => {
      setEnv({ ...validConfig, SLACK_SIGNING_SECRET: undefined });
      process.env['NOTIFIER_TYPE'] = 'slack';
      await expect(loadConfig()).rejects.toThrow(/SLACK_SIGNING_SECRET/);
    });
  });

  describe('CFG-04: teams requires valid webhook URL with api-version', () => {
    it('rejects teams without TEAMS_WEBHOOK_URL', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      await expect(loadConfig()).rejects.toThrow(/TEAMS_WEBHOOK_URL/);
    });

    it('rejects teams URL missing api-version query param', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      process.env['TEAMS_WEBHOOK_URL'] = 'https://prod.example.com/invoke';
      await expect(loadConfig()).rejects.toThrow(/api-version/);
    });

    it('accepts teams URL with api-version present (any value)', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      process.env['TEAMS_WEBHOOK_URL'] = 'https://prod.example.powerautomate.com/invoke?api-version=2024-10-01';
      const config = await loadConfig();
      expect(config.notifierType).toBe('teams');
      expect(config.teamsWebhookUrl).toContain('api-version=');
    });

    // CFG-04: brittle substring check would have accepted api-version= anywhere
    // in the URL (e.g. baked into the path). Validation must require it as a
    // proper query parameter.
    it('CFG-04: rejects teams URL where api-version= appears only in path, not as query param', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      process.env['TEAMS_WEBHOOK_URL'] = 'https://logic.azure.com/workflows/api-version=fake/invoke';
      await expect(loadConfig()).rejects.toThrow(/api-version/);
    });

    // CFG-05: URLs with api-version as a proper query parameter pass validation.
    it('CFG-05: accepts teams URL with api-version as proper query param', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      process.env['TEAMS_WEBHOOK_URL'] = 'https://prod.example.powerautomate.com/workflows/abc/triggers/manual/invoke?api-version=2016-10-01';
      const config = await loadConfig();
      expect(config.teamsWebhookUrl).toContain('api-version=2016-10-01');
    });
  });

  describe('CFG-05: no cross-pollution — teams ignores slack vars', () => {
    it('parses successfully when NOTIFIER_TYPE=teams and slack vars are also set', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      process.env['TEAMS_WEBHOOK_URL'] = 'https://prod.example.powerautomate.com/invoke?api-version=1';
      const config = await loadConfig();
      expect(config.notifierType).toBe('teams');
    });
  });

  describe('CFG-06: error message includes notifierType context', () => {
    it('error for missing TEAMS_WEBHOOK_URL includes "teams" context', async () => {
      setEnv({ ...validConfig });
      process.env['NOTIFIER_TYPE'] = 'teams';
      try {
        await loadConfig();
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('TEAMS_WEBHOOK_URL');
        expect(err.message).toContain('teams');
      }
    });
  });
});