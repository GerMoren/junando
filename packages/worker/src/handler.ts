import {
  LokiTraceRepository,
  NormalizedAlertSchema,
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  createNotifier,
  metrics,
  createLLMProvider,
  createLogger,
  reinitLogger,
  loadConfig,
  flushLoki,
  startSqsLagPoller,
} from '@junando/core';
import type { SQSEvent } from 'aws-lambda';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { isCsvBody, parseCsvBody } from './adapters/csv-input.adapter.js';
import type { CsvColumnMapping } from './adapters/csv-input.adapter.js';

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

// Start SQS lag poller at module scope when QUEUE_URL is available.
// setInterval fires in warm Lambda containers; no-op if QUEUE_URL is not set.
export let sqsLagPollerCleanup: (() => void) | undefined;
if (process.env['QUEUE_URL']) {
  const intervalMs = Number(process.env['SQS_LAG_POLL_INTERVAL_MS'] ?? '15000');
  sqsLagPollerCleanup = startSqsLagPoller(process.env['QUEUE_URL'], intervalMs);
}

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
  const notifier = createNotifier(config);

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

/** Parse an optional integer env var, returning undefined if unset or NaN */
function parseIntEnv(key: string): number | undefined {
  const val = process.env[key];
  if (!val) return undefined;
  const parsed = Number(val);
  return isNaN(parsed) ? undefined : parsed;
}

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
    // Auto-detect CSV vs JSON and parse accordingly
    let parsed: SQSMessage;
    try {
      if (isCsvBody(record.body)) {
        // CSV parsing with optional column mapping from env vars
        const fpCol = parseIntEnv('CSV_FINGERPRINT_COL');
        const epCol = parseIntEnv('CSV_ENDPOINT_COL');
        const extraLabels = process.env['CSV_EXTRA_LABELS'];
        const mapping: CsvColumnMapping = {
          serviceCol: Number(process.env['CSV_SERVICE_COL'] ?? 0),
          messageCol: Number(process.env['CSV_MESSAGE_COL'] ?? 1),
          severityCol: Number(process.env['CSV_SEVERITY_COL'] ?? 2),
          timestampCol: Number(process.env['CSV_TIMESTAMP_COL'] ?? 3),
          ...(fpCol !== undefined && { fingerprintCol: fpCol }),
          ...(epCol !== undefined && { endpointCol: epCol }),
          ...(extraLabels !== undefined && { extraLabels }),
        };
        const csvResult = parseCsvBody(record.body, mapping);
        if (!csvResult) {
          logger.error({ record: record.messageId }, 'CSV parse returned no valid alerts');
          continue;
        }
        parsed = csvResult;
        logger.info({ alertCount: parsed.alerts.length }, 'Parsed CSV SQS message');
      } else {
        // JSON parsing — original behavior
        const raw = JSON.parse(record.body);
        const result = SQSMessageSchema.safeParse(raw);
        if (!result.success) {
          logger.error({ err: result.error.issues }, 'Invalid SQS message body');
          // Don't throw — let SQS retry and eventually DLQ
          continue;
        }
        parsed = result.data;
      }
    } catch (err) {
      logger.error({ err }, 'Failed to parse SQS message body');
      continue;
    }

    // If this throws, SQS retries automatically. After max retries → DLQ.
    try {
      await useCaseInstance.execute(parsed.alerts, parsed.correlationId);
      metrics.alertsProcessed.inc({ result: 'success' });
    } catch (err) {
      metrics.alertsProcessed.inc({ result: 'failure' });
      throw err;
    }
  }
}
