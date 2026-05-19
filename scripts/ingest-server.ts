/**
 * ingest-server.ts
 * Composition root for the Junando ingest service.
 *
 * Reads Loki on a fixed interval, maps log results to NormalizedAlerts,
 * and forwards them to ProcessIncidentUseCase. Drains in-flight work on
 * SIGTERM / SIGINT before exiting.
 */
import { createLogger, flushLoki, loadConfig, reinitLogger } from "@junando/core";
import { loadIngestConfig } from "@junando/ingest";
import { readFileSync } from "node:fs";
import { createProcessIncidentUseCase } from "./factories/process-incident.factory.js";
import { createIngestRuntime } from "./ingest/runtime.js";
import { assertMapperRegistered } from "./assert-mapper-registered.js";

// ---------------------------------------------------------------------------
// 1. Load and validate ingest config — fail fast on invalid
// ---------------------------------------------------------------------------

const configPath = process.env["INGEST_CONFIG_PATH"];
if (!configPath) {
  console.error("INGEST_CONFIG_PATH environment variable is required");
  process.exit(1);
}

let rawYaml: string;
try {
  rawYaml = readFileSync(configPath, "utf-8");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed to read ingest config at "${configPath}": ${msg}`);
  process.exit(1);
}

let ingestConfig;
try {
  ingestConfig = loadIngestConfig(rawYaml);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Invalid ingest config: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Base app config + logger
// ---------------------------------------------------------------------------

const logger = createLogger();
const appConfig = await loadConfig();
reinitLogger({ level: appConfig.logLevel });

// ---------------------------------------------------------------------------
// 2.5. Pre-flight: verify mapper is registered before announcing startup (SQS only)
// ---------------------------------------------------------------------------

assertMapperRegistered(ingestConfig, logger);

if (ingestConfig.ingest.kind === "loki") {
  logger.info(
    {
      service: "junando-ingest",
      kind: "loki",
      intervalMs: ingestConfig.ingest.intervalMs,
      rules: ingestConfig.ingest.rules.length,
    },
    `junando ingest running in loki mode, intervalMs=${ingestConfig.ingest.intervalMs}, rules=${ingestConfig.ingest.rules.length}`,
  );
} else {
  logger.info(
    {
      service: "junando-ingest",
      kind: "sqs",
      queueUrl: ingestConfig.ingest.sqs.queueUrl,
      batchSize: ingestConfig.ingest.sqs.batchSize,
      maxInFlight: ingestConfig.ingest.sqs.maxInFlight,
      mapperKind: ingestConfig.ingest.mapper.kind,
    },
    `junando ingest running in sqs mode, mapper=${ingestConfig.ingest.mapper.kind}`,
  );
}

// ---------------------------------------------------------------------------
// 3. ProcessIncidentUseCase — via shared factory (Slice 0)
// ---------------------------------------------------------------------------

const processIncidentUseCase = createProcessIncidentUseCase({ config: appConfig, logger });

// ---------------------------------------------------------------------------
// 4. Runtime selection
// ---------------------------------------------------------------------------

const runtime = createIngestRuntime({
  ingestConfig,
  processIncidentUseCase,
  logger,
});

// ---------------------------------------------------------------------------
// 6. Signal handlers — drain in-flight work before exit
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, `${signal} received — stopping ingest runtime`);
  await runtime.stop();
  await flushLoki();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// 7. Start
// ---------------------------------------------------------------------------

runtime.start();
