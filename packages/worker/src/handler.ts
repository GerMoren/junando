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
      alertName: z.string(),
      status: z.string(),
      serviceName: z.string(),
      alertType: z.string(),
      endpointPath: z.string(),
      traceId: z.string().optional(),
      startsAt: z.string(),
      latencyMs: z.number().optional(),
      labels: z.record(z.string()),
      annotations: z.record(z.string()),
    }),
  ),
});

export type SQSMessage = z.infer<typeof SQSMessageSchema>;

// Lazy initialization - config and dependencies loaded on first invocation
// This allows SSM secrets to be read at runtime (avoids SecureString CDK issue)
let useCase: ProcessIncidentUseCase;
let logger: ReturnType<typeof createLogger>;

async function getUseCase(): Promise<ProcessIncidentUseCase> {
  if (useCase) {
    return useCase;
  }

  const config = await loadConfig();
  logger = createLogger(config.logLevel);

  const redis = new Redis(config.redisUrl, { lazyConnect: true });

  const dedup = new RedisDeduplicationStore(redis);
  const traces = new LokiTraceRepository(config.lokiUrl);
  const llm = createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel);
  const notifier = new SlackNotifier(config.slackBotToken, config.slackChannel);

  useCase = new ProcessIncidentUseCase({
    dedup,
    traces,
    llm,
    notifier,
    logger,
    dedupTtlSeconds: config.dedupTtlSeconds,
  });

  return useCase;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  const useCaseInstance = await getUseCase();

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
    await useCaseInstance.execute(
      parsed.alerts as unknown as NormalizedAlert[],
      parsed.correlationId,
    );
  }
};
