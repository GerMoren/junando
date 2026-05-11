import {
  LokiTraceRepository,
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  SlackNotifier,
  createLLMProvider,
  createLogger,
  loadConfig,
  type NormalizedAlert,
} from '@junando/core';
import type { SQSEvent } from 'aws-lambda';
import { Redis } from 'ioredis';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Lambda B — SQS Worker
// Reads message from SQS → runs the full pipeline via ProcessIncidentUseCase.
// All dependencies are injected here — the use case never imports concrete classes.
// ─────────────────────────────────────────────────────────────────────────────

const SQSMessageSchema = z.object({
  correlationId: z.string().uuid(),
  alerts: z.array(
    z.object({
      fingerprint: z.string(),
      serviceName: z.string(),
      alertType: z.string(),
      endpointPath: z.string(),
      latencyP99Ms: z.number().optional(),
      labels: z.record(z.string(), z.string()).optional(),
      annotations: z
        .object({
          summary: z.string().optional(),
          description: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

export type SQSMessage = z.infer<typeof SQSMessageSchema>;

// Initialize once per Lambda container (warm starts reuse these)
const config = loadConfig();
const logger = createLogger(config.logLevel);
const redis = new Redis(config.redisUrl, { lazyConnect: true });

// Wire up adapters — swap any of these without touching use case or domain
const dedup = new RedisDeduplicationStore(redis);
const traces = new LokiTraceRepository(config.lokiUrl);
const llm = createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel);
const notifier = new SlackNotifier(config.slackBotToken, config.slackChannel);

const useCase = new ProcessIncidentUseCase({
  dedup,
  traces,
  llm,
  notifier,
  logger,
  dedupTtlSeconds: config.dedupTtlSeconds,
});

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    // Validate SQS message body with Zod before processing
    let parsed: SQSMessage;
    try {
      const raw = JSON.parse(record.body);
      const result = SQSMessageSchema.safeParse(raw);
      if (!result.success) {
        logger.error({ err: result.error.issues }, 'Invalid SQS message body');
        // Don't throw — let SQS retry and eventually DLQ
        continue;
      }
      parsed = result.data;
    } catch (err) {
      logger.error({ err }, 'Failed to parse SQS message body');
      continue;
    }

    // If this throws, SQS retries automatically. After max retries → DLQ.
    await useCase.execute(parsed.alerts as unknown as NormalizedAlert[], parsed.correlationId);
  }
};
