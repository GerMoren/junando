#!/usr/bin/env tsx
/**
 * worker-local.ts
 * Simulates Lambda B (SQS Worker) for local end-to-end testing.
 *
 * Usage:
 *   pnpm run worker:local --file ./tmp/alerts.json
 *   pnpm run worker:local --count 3 --type error
 */
import {
  AlertCluster,
  AlertType,
  HOUR_MS,
  LokiTraceRepository,
  MockLLMProvider,
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  SlackNotifier,
  WEBHOOK_DEFAULTS,
  createLLMProvider,
  createLogger,
  loadConfig,
  normalizePayload,
  type AlertmanagerPayload,
  type NormalizedAlert,
} from "@junando/core";
import { Redis } from "ioredis";
import fs from "node:fs/promises";
import path from "node:path";

const logger = createLogger();

const args = process.argv.slice(2);

async function main() {
  const config = await loadConfig();

  logger.info("Initializing worker-local...");

  const redis = new Redis(config.redisUrl, { lazyConnect: true });
  try {
    await redis.connect();
    logger.info("Redis connected");
  } catch (err) {
    logger.error({ err }, "Redis connection failed");
    process.exit(1);
  }

  const useMock = args.includes("--mock");
  const dedup = new RedisDeduplicationStore(redis);
  const traces = new LokiTraceRepository(config.lokiUrl);
  const llm = useMock
    ? new MockLLMProvider()
    : createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel);
  const notifier = new SlackNotifier(config.slackBotToken, config.slackChannel);

  const useCase = new ProcessIncidentUseCase({
    dedup,
    traces,
    llm,
    notifier,
    logger,
    dedupTtlSeconds: config.dedupTtlSeconds,
  });

  let alerts: NormalizedAlert[] = [];
  const correlationId = `local-${Date.now()}`;

  const fileIndex = args.indexOf("--file");
  const countIndex = args.indexOf("--count");
  const typeIndex = args.indexOf("--type");

  const nextArg = args[fileIndex + 1];
  if (fileIndex !== -1 && nextArg) {
    const filePath = path.resolve(process.cwd(), nextArg);
    logger.info({ filePath }, "Loading alerts from file");
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    alerts = normalizePayload(data);
  } else if (countIndex === -1) {
    logger.error("No input: use --file <path> or --count <n>");
    process.exit(1);
  } else {
    const countArg = args[countIndex + 1];
    const count = Number.parseInt(countArg ?? "3", 10);
    const typeArg = args[typeIndex + 1];
    const rawType = typeIndex === -1 || !typeArg ? "error" : typeArg;

    const TYPE_MAP: ReadonlyMap<string, AlertType> = new Map([
      ["error", AlertType.Error],
      ["warning", AlertType.Warning],
      ["success", AlertType.Success],
    ]);

    const alertType = TYPE_MAP.get(rawType) ?? AlertType.Error;
    logger.info({ count, alertType: String(alertType) }, "Generating alerts");

    const SEVERITY_MAP: ReadonlyMap<AlertType, string> = new Map([
      [AlertType.Error, "critical"],
      [AlertType.Warning, "warning"],
      [AlertType.Success, "info"],
    ]);

    const ALERT_NAME_MAP: ReadonlyMap<AlertType, string> = new Map([
      [AlertType.Error, "HighErrorRate"],
      [AlertType.Warning, "HighLatency"],
      [AlertType.Success, "ServiceRecovered"],
    ]);

    const severity = SEVERITY_MAP.get(alertType) ?? "critical";
    const alertName = ALERT_NAME_MAP.get(alertType) ?? "HighErrorRate";
    const isResolved = alertType === AlertType.Success;

    const mockPayload = {
      version: "4",
      groupKey: `{}:{alertname="${alertName}"}`,
      status: isResolved ? "resolved" : "firing",
      truncatedAlerts: 0,
      receiver: "test",
      groupLabels: { alertname: alertName },
      commonLabels: { severity },
      commonAnnotations: {},
      externalURL: WEBHOOK_DEFAULTS.AlertmanagerUrl,
      alerts: Array.from({ length: count }, (_, i) => ({
        status: isResolved ? "resolved" : "firing",
        labels: {
          alertname: alertName,
          service: "test-service",
          error_type: alertType,
          endpoint: "/api/test",
          severity,
        },
        annotations: {
          summary: `Test alert ${i + 1} for ${alertType}`,
        },
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + HOUR_MS).toISOString(),
        fingerprint: Math.random().toString(36).slice(2),
      })),
    };

    alerts = normalizePayload(mockPayload as AlertmanagerPayload);
    logger.info({ alertCount: alerts.length }, "Generated normalized alerts");
  }

  logger.info({ alertCount: alerts.length, correlationId }, "Executing pipeline");

  const startTime = Date.now();

  const clusters = useCase["clustering"].buildClusters(alerts);
  logger.info({ clusterCount: clusters.length }, "Clusters built");

  try {
    await useCase.execute(alerts, correlationId);
    const duration = Date.now() - startTime;

    logger.info({ durationMs: duration }, "Pipeline completed successfully");

    const tmpDir = path.join(process.cwd(), "tmp");
    await fs.mkdir(tmpDir, { recursive: true });
    const responsePath = path.join(tmpDir, "response.json");
    await fs.writeFile(
      responsePath,
      JSON.stringify(
        {
          correlationId,
          timestamp: new Date().toISOString(),
          durationMs: duration,
          alertsCount: alerts.length,
          clusterCount: clusters.length,
          clusters: clusters.map((c: AlertCluster) => ({
            serviceName: c.serviceName,
            alertType: c.alertType,
            alertCount: c.alertCount,
          })),
        },
        null,
        2,
      ),
    );
    logger.info({ responsePath }, "Response saved");

    await redis.quit();
    process.exit(0);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ err, durationMs: duration }, "Pipeline failed");
    await redis.quit();
    process.exit(1);
  }
}

try {
  await main();
} catch (err: any) {
  logger.fatal({ err }, "Fatal error in worker-local");
  process.exit(1);
}
