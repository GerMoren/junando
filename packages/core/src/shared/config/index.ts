import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { z } from 'zod';
import { LLM_FALLBACK_DEFAULTS } from '../constants.js';
import { createLogger } from '../logger/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Config — reads and validates all env vars at startup.
// The process exits immediately if a required variable is missing.
// No silent failures, no undefined values in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

// Load secrets from SSM using SSM_PREFIX (AWS Lambda deployment)
async function loadSecretsFromSSM(): Promise<void> {
  const prefix = process.env.SSM_PREFIX;
  // Only run in AWS (when SSM_PREFIX is set), skip in local dev
  if (!prefix) {
    return;
  }

  const client = new SSMClient({});
  const names = [
    `${prefix}/llm-provider`,
    `${prefix}/llm-api-key`,
    `${prefix}/llm-model`,
    `${prefix}/slack-bot-token`,
    `${prefix}/slack-signing-secret`,
    `${prefix}/slack-channel`,
    `${prefix}/loki-url`,
    `${prefix}/redis-url`,
    `${prefix}/llm-fallback-models`,
    `${prefix}/llm-fallback-timeout-ms`,
  ];

  try {
    const result = await client.send(
      new GetParametersCommand({
        Names: names,
        WithDecryption: true,
      }),
    );

    for (const param of result.Parameters ?? []) {
      if (param.Name && param.Value) {
        // Convert /junando/llm-provider -> LLM_PROVIDER
        const key = param.Name.replace(`${prefix}/`, '').replaceAll('-', '_').toUpperCase();
        process.env[key] = param.Value;
      }
    }
  } catch (err) {
    createLogger().error({ err }, 'Failed to load SSM parameters');
  }
}

const ConfigSchema = z.object({
  llmProvider: z.enum(['gemini', 'claude', 'openrouter', 'qwen']),
  llmApiKey: z.string().min(1),
  llmModel: z.string().optional().transform((v) => v === '' ? undefined : v),
  slackBotToken: z.string().startsWith('xoxb-'),
  slackSigningSecret: z.string().min(1),
  slackChannel: z.string().startsWith('#'),
  lokiUrl: z.string().min(1), // URL with embedded credentials — skip .url() which rejects user:pass@ format
  redisUrl: z.string().url(),
  sqsQueueUrl: z.string().url().optional().or(z.literal('')),
  dedupTtlSeconds: z.coerce.number().int().positive().default(300),
  clusterWindowMs: z.coerce.number().int().positive().default(120_000),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  llmFallbackModels: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return LLM_FALLBACK_DEFAULTS.Models;
      if (!v) return [];
      return v.split(',').map((s) => s.trim()).filter(Boolean);
    }),
  llmFallbackTimeoutMs: z.coerce.number().int().positive().default(LLM_FALLBACK_DEFAULTS.TimeoutMs),
});

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<Config> {
  await loadSecretsFromSSM();

  const result = ConfigSchema.safeParse({
    llmProvider: process.env['LLM_PROVIDER'],
    llmApiKey: process.env['LLM_API_KEY'],
    llmModel: process.env['LLM_MODEL'],
    slackBotToken: process.env['SLACK_BOT_TOKEN'],
    slackSigningSecret: process.env['SLACK_SIGNING_SECRET'],
    slackChannel: process.env['SLACK_CHANNEL'],
    lokiUrl: process.env['LOKI_URL'],
    redisUrl: process.env['REDIS_URL'],
    sqsQueueUrl: process.env['SQS_QUEUE_URL'],
    dedupTtlSeconds: process.env['DEDUP_TTL_SECONDS'],
    clusterWindowMs: process.env['CLUSTER_WINDOW_MS'],
    logLevel: process.env['LOG_LEVEL'],
    nodeEnv: process.env['NODE_ENV'],
    llmFallbackModels: process.env['LLM_FALLBACK_MODELS'],
    llmFallbackTimeoutMs: process.env['LLM_FALLBACK_TIMEOUT_MS'],
  });

  if (!result.success) {
    const errorMessages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n  - ${errorMessages.join('\n  - ')}`);
  }

  return result.data;
}
