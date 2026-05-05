import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Config — reads and validates all env vars at startup.
// The process exits immediately if a required variable is missing.
// No silent failures, no undefined values in the codebase.
// ─────────────────────────────────────────────────────────────────────────────

const ConfigSchema = z.object({
  llmProvider:        z.enum(['gemini', 'claude']),
  llmApiKey:          z.string().min(1),
  llmModel:           z.string().optional(),
  slackBotToken:      z.string().startsWith('xoxb-'),
  slackSigningSecret: z.string().min(1),
  slackChannel:       z.string().startsWith('#'),
  lokiUrl:            z.string().url(),
  redisUrl:           z.string().url(),
  sqsQueueUrl:        z.string().url().optional(),
  dedupTtlSeconds:    z.coerce.number().int().positive().default(300),
  clusterWindowMs:    z.coerce.number().int().positive().default(120_000),
  logLevel:           z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv:            z.enum(['development', 'test', 'production']).default('development'),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    llmProvider:        process.env['LLM_PROVIDER'],
    llmApiKey:          process.env['LLM_API_KEY'],
    llmModel:           process.env['LLM_MODEL'],
    slackBotToken:      process.env['SLACK_BOT_TOKEN'],
    slackSigningSecret: process.env['SLACK_SIGNING_SECRET'],
    slackChannel:       process.env['SLACK_CHANNEL'],
    lokiUrl:            process.env['LOKI_URL'],
    redisUrl:           process.env['REDIS_URL'],
    sqsQueueUrl:        process.env['SQS_QUEUE_URL'],
    dedupTtlSeconds:    process.env['DEDUP_TTL_SECONDS'],
    clusterWindowMs:    process.env['CLUSTER_WINDOW_MS'],
    logLevel:           process.env['LOG_LEVEL'],
    nodeEnv:            process.env['NODE_ENV'],
  })

  if (!result.success) {
    console.error('❌ Invalid configuration:')
    result.error.issues.forEach((issue) => {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
    })
    process.exit(1)
  }

  return result.data
}
