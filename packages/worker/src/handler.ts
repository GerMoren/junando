import type { SQSEvent } from 'aws-lambda'
import { Redis } from 'ioredis'
import {
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  LokiTraceRepository,
  SlackNotifier,
  createLLMProvider,
  createLogger,
  loadConfig,
} from '@junando/core'
import type { NormalizedAlert } from '@junando/core'

// ─────────────────────────────────────────────────────────────────────────────
// Lambda B — SQS Worker
// Reads message from SQS → runs the full pipeline via ProcessIncidentUseCase.
// All dependencies are injected here — the use case never imports concrete classes.
// ─────────────────────────────────────────────────────────────────────────────

// Initialize once per Lambda container (warm starts reuse these)
const config  = loadConfig()
const logger  = createLogger(config.logLevel)
const redis   = new Redis(config.redisUrl, { lazyConnect: true })

// Wire up adapters — swap any of these without touching use case or domain
const dedup    = new RedisDeduplicationStore(redis)
const traces   = new LokiTraceRepository(config.lokiUrl)
const llm      = createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel)
const notifier = new SlackNotifier(config.slackBotToken, config.slackChannel)

const useCase = new ProcessIncidentUseCase({ dedup, traces, llm, notifier, logger, dedupTtlSeconds: config.dedupTtlSeconds })

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { correlationId, alerts } = JSON.parse(record.body) as {
      correlationId: string
      alerts: NormalizedAlert[]
    }

    // If this throws, SQS retries automatically. After max retries → DLQ.
    await useCase.execute(alerts, correlationId)
  }
}
