// ─────────────────────────────────────────────────────────────────────────────
// constants.ts — Centralized constants and enums.
// No magic numbers. No hardcoded strings. Everything typed and named.
// ─────────────────────────────────────────────────────────────────────────────

// ── Alert Types (domain enum) ──────────────────────────────────────────────────
export enum AlertType {
  Error = 'http_500',
  Warning = 'latency_spike',
  Success = 'recovery',
}

interface AlertTypeConfig {
  readonly alertName: string;
  readonly severity: string;
  readonly summary: (service: string, i: number, count: number) => string;
}

const _alertTypeConfigs: Record<AlertType, AlertTypeConfig> = {
  [AlertType.Error]: {
    alertName: 'HighErrorRate',
    severity: 'critical',
    summary: (service, i, count) => `High error rate on ${service} — alert ${i + 1}/${count}`,
  },
  [AlertType.Warning]: {
    alertName: 'HighLatency',
    severity: 'warning',
    summary: (service, i, count) => `High latency detected on ${service} — alert ${i + 1}/${count}`,
  },
  [AlertType.Success]: {
    alertName: 'ServiceRecovered',
    severity: 'info',
    summary: (service, i, count) =>
      `Service ${service} has recovered and is operating normally — alert ${i + 1}/${count}`,
  },
};

export const ALERT_TYPE_LABELS: Readonly<typeof _alertTypeConfigs> =
  Object.freeze(_alertTypeConfigs);

// ── LLM Provider ───────────────────────────────────────────────────────────────
export enum LLMProviderType {
  Gemini = 'gemini',
  Claude = 'claude',
  OpenRouter = 'openrouter',
  Qwen = 'qwen',
}

// ── HTTP / Timeout Constants ───────────────────────────────────────────────────
export const HTTP_TIMEOUT_MS = Object.freeze({
  Default: 5_000,
  LLM: 30_000,
  SlackResponseUrl: 500,
  RollbackHandler: 2_000,
});

export const CIRCUIT_BREAKER = Object.freeze({
  Timeout: 10_000,
  ErrorThresholdPercentage: 70,
  ResetTimeoutMs: 30_000,
});

export const LLM_MAX_TOKENS = 1_024;

// ── Rate Limiter Constants ─────────────────────────────────────────────────────
export const RATE_LIMITER = Object.freeze({
  MinTimeMs: 100,
  MaxConcurrent: 5,
});

// ── Dev Server ────────────────────────────────────────────────────────────────
export const DEV_SERVER_PORT = 4_000;

// ── Deduplication ─────────────────────────────────────────────────────────────
export const DEDUP_TTL_MS_MULTIPLIER = 1_000;

// ── Time Conversions ───────────────────────────────────────────────────────────
export const HOUR_MS = 3_600_000;

// ── LLM Fallback Defaults ─────────────────────────────────────────────────
export const LLM_FALLBACK_DEFAULTS = Object.freeze({
  TimeoutMs: 60_000,
  Models: [
    'google/gemma-4-31b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
  ] as string[],
});

// ── LLM Models ────────────────────────────────────────────────────────────────
export const LLM_MODELS = Object.freeze({
  Gemini: 'gemini-2.0-flash',
  Claude: 'claude-haiku-4-5',
  OpenRouter: 'qwen/qwen-2.5-72b-instruct',
});

// ── Slack ─────────────────────────────────────────────────────────────────────
export const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
export const ROLLBACK_ACTION_ID = 'trigger_rollback';

// ── Teams ─────────────────────────────────────────────────────────────────────
export const TEAMS_WEBHOOK_TIMEOUT_MS = 10_000;

const _urgencyEmoji: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};
export const URGENCY_EMOJI: Readonly<typeof _urgencyEmoji> = Object.freeze(_urgencyEmoji);

// ── Redis Keys ────────────────────────────────────────────────────────────────
export const REDIS_KEY_PREFIX = 'junando:dedup:';

// ── Webhook Defaults ──────────────────────────────────────────────────────────
export const WEBHOOK_DEFAULTS = Object.freeze({
  AlertmanagerUrl: 'http://localhost:9093',
  WebhookUrl: 'http://localhost:4000/webhook/alert',
});

export const PAYLOAD_DEFAULTS = Object.freeze({
  Version: '4',
  TruncatedAlerts: 0,
  Receiver: 'junando',
});
