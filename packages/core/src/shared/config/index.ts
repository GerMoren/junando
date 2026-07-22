import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { z } from 'zod';
import { LLM_FALLBACK_DEFAULTS } from '../constants.js';
import { createLogger } from '../logger/index.js';

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

function parseOptionalStringArray(value: string | undefined): string[] | undefined {
  if (value === undefined || value === '') return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config — reads and validates all env vars at startup.
// The process exits immediately if a required variable is missing.
// No silent failures, no undefined values in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

export enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

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
    `${prefix}/rollback-action-enabled`,
    `${prefix}/rollback-action-allowed-slack-user-ids`,
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

const ConfigSchema = z
  .object({
    llmProvider: z.enum(['gemini', 'claude', 'openrouter', 'qwen']),
    llmApiKey: z.string().min(1),
    llmModel: z.string().optional().transform((v) => v === '' ? undefined : v),
    // Notifier selector — defaults to 'slack' for backward compatibility
    notifierType: z.enum(['slack', 'teams']).default('slack'),
    // Slack fields — optional at schema level; superRefine enforces them conditionally
    slackBotToken: z.string().startsWith('xoxb-').optional(),
    slackSigningSecret: z.string().min(1).optional(),
    slackChannel: z.string().startsWith('#').optional(),
    // Rollback action authorization — only applies when notifierType is 'slack'
    rollbackActionEnabled: z.boolean().default(false),
    rollbackActionAllowedSlackUserIds: z.array(z.string()).optional(),
    // Teams field
    teamsWebhookUrl: z.string().url().optional(),
    lokiUrl: z.string().optional().transform((v) => v === '' ? undefined : v), // URL with embedded credentials — skip .url() which rejects user:pass@ format. Optional: containers may run without Loki; logger falls back to stdout. Empty string is coerced to undefined (env var unset vs empty are equivalent).
    redisUrl: z.string().url(),
    sqsQueueUrl: z.string().url().optional().or(z.literal('')),
    dedupTtlSeconds: z.coerce.number().int().positive().default(300),
    clusterWindowMs: z.coerce.number().int().positive().default(120_000),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    nodeEnv: z.nativeEnum(NodeEnvironment).default(NodeEnvironment.Development),
    llmFallbackModels: z
      .string()
      .optional()
      .transform((v) => {
        if (v === undefined) return LLM_FALLBACK_DEFAULTS.Models;
        if (!v) return [];
        return v.split(',').map((s) => s.trim()).filter(Boolean);
      }),
    llmFallbackTimeoutMs: z.coerce.number().int().positive().default(LLM_FALLBACK_DEFAULTS.TimeoutMs),
    // Optional path to rules.yaml for business rules engine. When not set, rule engine is disabled.
    rulesConfigPath: z
      .string()
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
  })
  .superRefine((data, ctx) => {
    if (data.notifierType === 'slack') {
      if (!data.slackBotToken) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slackBotToken'],
          message: '[notifierType: slack] SLACK_BOT_TOKEN is required and must start with xoxb-',
        });
      }
      if (!data.slackChannel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slackChannel'],
          message: '[notifierType: slack] SLACK_CHANNEL is required and must start with #',
        });
      }
      if (!data.slackSigningSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slackSigningSecret'],
          message: '[notifierType: slack] SLACK_SIGNING_SECRET is required (used to verify Slack interactivity callbacks)',
        });
      }
    }
    if (data.notifierType === 'teams') {
      if (!data.teamsWebhookUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teamsWebhookUrl'],
          message: '[notifierType: teams] TEAMS_WEBHOOK_URL is required',
        });
      } else {
        // Parse the URL and require api-version as a real query parameter,
        // not just any substring (which would accept e.g. an api-version=
        // segment baked into the URL path).
        let parsed: URL | undefined;
        try {
          parsed = new URL(data.teamsWebhookUrl);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['teamsWebhookUrl'],
            message: '[notifierType: teams] TEAMS_WEBHOOK_URL must be a valid URL',
          });
        }
        if (parsed && !parsed.searchParams.has('api-version')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['teamsWebhookUrl'],
            message: '[notifierType: teams] TEAMS_WEBHOOK_URL must include api-version= as a query parameter',
          });
        }
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(): Promise<Config> {
  await loadSecretsFromSSM();

  const result = ConfigSchema.safeParse({
    llmProvider: process.env['LLM_PROVIDER'],
    llmApiKey: process.env['LLM_API_KEY'],
    llmModel: process.env['LLM_MODEL'],
    notifierType: process.env['NOTIFIER_TYPE'],
    slackBotToken: process.env['SLACK_BOT_TOKEN'],
    slackSigningSecret: process.env['SLACK_SIGNING_SECRET'],
    slackChannel: process.env['SLACK_CHANNEL'],
    teamsWebhookUrl: process.env['TEAMS_WEBHOOK_URL'],
    lokiUrl: process.env['LOKI_URL'],
    redisUrl: process.env['REDIS_URL'],
    sqsQueueUrl: process.env['SQS_QUEUE_URL'],
    dedupTtlSeconds: process.env['DEDUP_TTL_SECONDS'],
    clusterWindowMs: process.env['CLUSTER_WINDOW_MS'],
    logLevel: process.env['LOG_LEVEL'],
    nodeEnv: process.env['NODE_ENV'],
    llmFallbackModels: process.env['LLM_FALLBACK_MODELS'],
    llmFallbackTimeoutMs: process.env['LLM_FALLBACK_TIMEOUT_MS'],
    rulesConfigPath: process.env['RULES_CONFIG_PATH'],
    rollbackActionEnabled: parseBooleanEnv(process.env['ROLLBACK_ACTION_ENABLED']) ?? false,
    rollbackActionAllowedSlackUserIds: parseOptionalStringArray(
      process.env['ROLLBACK_ACTION_ALLOWED_SLACK_USER_IDS'],
    ),
  });

  if (!result.success) {
    const errorMessages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n  - ${errorMessages.join('\n  - ')}`);
  }

  return result.data;
}
