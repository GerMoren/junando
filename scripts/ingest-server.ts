/**
 * ingest-server.ts
 * Composition root for the Junando ingest service.
 *
 * Reads Loki on a fixed interval, maps log results to NormalizedAlerts,
 * and forwards them to ProcessIncidentUseCase. Drains in-flight work on
 * SIGTERM / SIGINT before exiting.
 */
import { readFileSync } from "node:fs";
import { createLogger, flushLoki, loadConfig, reinitLogger } from "@junando/core";
import {
  IngestRunner,
  loadIngestConfig,
  type IngestConfig,
  type LokiIngestConfig,
} from "@junando/ingest";
import { LokiHttpClient } from "@junando/ingest/loki-http-client";
import { createProcessIncidentUseCase } from "./factories/process-incident.factory.js";

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

function requireLokiIngestConfig(config: IngestConfig): LokiIngestConfig {
  if (config.ingest.kind !== "loki") {
    console.error(
      `ingest-server currently supports only kind=loki configs; received kind=${config.ingest.kind}`,
    );
    process.exit(1);
  }

  return config as LokiIngestConfig;
}

const lokiIngestConfig = requireLokiIngestConfig(ingestConfig);

// ---------------------------------------------------------------------------
// 2. Base app config + logger
// ---------------------------------------------------------------------------

const logger = createLogger();
const appConfig = await loadConfig();
reinitLogger({ level: appConfig.logLevel });

logger.info(
  {
    service: "junando-ingest",
    intervalMs: lokiIngestConfig.ingest.intervalMs,
    rules: lokiIngestConfig.ingest.rules.length,
  },
  `junando ingest running, intervalMs=${lokiIngestConfig.ingest.intervalMs}, rules=${lokiIngestConfig.ingest.rules.length}`,
);

// ---------------------------------------------------------------------------
// 3. ProcessIncidentUseCase — via shared factory (Slice 0)
// ---------------------------------------------------------------------------

const processIncidentUseCase = createProcessIncidentUseCase({ config: appConfig, logger });

// ---------------------------------------------------------------------------
// 4. LokiHttpClient
// ---------------------------------------------------------------------------

const lokiAuth = lokiIngestConfig.ingest.loki.auth;
const lokiClient = new LokiHttpClient({
  baseUrl: lokiIngestConfig.ingest.loki.url,
  timeoutMs: lokiIngestConfig.ingest.loki.timeoutMs,
  ...(lokiAuth !== undefined ? { auth: lokiAuth } : {}),
});

// ---------------------------------------------------------------------------
// 5. IngestRunner
// ---------------------------------------------------------------------------

const runner = new IngestRunner({
  config: lokiIngestConfig,
  lokiClient,
  processIncidentUseCase,
  logger,
});

// ---------------------------------------------------------------------------
// 6. Signal handlers — drain in-flight work before exit
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, `${signal} received — stopping ingest runner`);
  await runner.stop();
  await flushLoki();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// 7. Start
// ---------------------------------------------------------------------------

runner.start();
