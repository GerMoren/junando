import {
  LokiTraceRepository,
  NormalizedAlertSchema,
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  SlackNotifier,
  metrics,
  createLLMProvider,
  createLogger,
  reinitLogger,
  loadConfig,
  flushLoki,
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
  alerts: z.array(NormalizedAlertSchema),
});

export type SQSMessage = z.infer<typeof SQSMessageSchema>;

// Lazy initialization - config and dependencies loaded on first invocation
// This allows SSM secrets to be read at runtime (avoids SecureString CDK issue)
let useCase: ProcessIncidentUseCase;
let logger: ReturnType<typeof createLogger> = createLogger();

async function getUseCase(): Promise<ProcessIncidentUseCase> {
  if (useCase) {
    return useCase;
  }

  const config = await loadConfig();
  reinitLogger({ level: config.logLevel }); // swap in Loki transport now that LOKI_URL is set
  logger = createLogger(config.logLevel);

  const redis = new Redis(config.redisUrl, { lazyConnect: true });

  const dedup = new RedisDeduplicationStore(redis);
  const traces = new LokiTraceRepository(config.lokiUrl ?? '');
  const llm = createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel);
  const notifier = new SlackNotifier(config.slackBotToken, config.slackChannel);

  useCase = new ProcessIncidentUseCase({
    dedup,
    traces,
    llm,
    notifier,
    logger,
    dedupTtlSeconds: config.dedupTtlSeconds,
    onClustersBuilt: (count) => metrics.alertClusters.set(count),
  });

  return useCase;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  try {
    return await _handler(event);
  } finally {
    // Flush buffered logs to Loki before Lambda exits.
    // In a finally block so logs are pushed even when the use case throws.
    await flushLoki();
  }
};

async function _handler(event: SQSEvent): Promise<void> {
  let useCaseInstance: ProcessIncidentUseCase;
  try {
    useCaseInstance = await getUseCase();
  } catch (err) {
    // getUseCase() failed (likely loadConfig/SSM error). The module-level proxy
    // logger writes to stdout via the initial root, so we always have a working
    // logger here even if reinitLogger() never ran.
    logger.fatal({ err }, 'getUseCase() failed — Lambda will retry via SQS');
    throw err; // re-throw so SQS retries
  }

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
    await useCaseInstance.execute(parsed.alerts, parsed.correlationId);
  }
}
