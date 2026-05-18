#!/usr/bin/env tsx
/**
 * ingest-local.ts
 * Local smoke test for the ingest pipeline.
 *
 * Fires ONE tick of the IngestRunner against the local Loki instance,
 * waits for it to drain, then exits. Uses MockLLMProvider by default
 * so no LLM credits are consumed.
 *
 * Usage:
 *   pnpm ingest:local                          # one tick, mock LLM
 *   pnpm ingest:local --config ./my.yaml       # custom ingest config
 *   pnpm ingest:local --real-llm               # use real LLM from .env.local
 *
 * Requires .env.local to be present (REDIS_URL, SLACK_BOT_TOKEN, etc.)
 * Requires Loki running at LOKI_URL (default http://localhost:3100)
 */
import { readFileSync } from 'node:fs';
import {
  MockLLMProvider,
  LokiTraceRepository,
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
  createNotifier,
  createLLMProvider,
  createLogger,
  flushLoki,
  loadConfig,
  reinitLogger,
} from '@junando/core';
import { IngestRunner, loadIngestConfig } from '@junando/ingest';
import { LokiHttpClient } from '@junando/ingest/loki-http-client';
import { Redis } from 'ioredis';
import { createProcessIncidentUseCase } from './factories/process-incident.factory.js';

const logger = createLogger();

const args = process.argv.slice(2);
const useRealLlm = args.includes('--real-llm');
const configIndex = args.indexOf('--config');
const configPath =
  configIndex !== -1 && args[configIndex + 1]
    ? args[configIndex + 1]!
    : process.env['INGEST_CONFIG_PATH'] ?? './docker/ingest.config.example.yaml';

// ---------------------------------------------------------------------------
// 1. Load ingest config
// ---------------------------------------------------------------------------

logger.info({ configPath }, 'Loading ingest config');

let rawYaml: string;
try {
  rawYaml = readFileSync(configPath, 'utf-8');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`Failed to read ingest config at "${configPath}": ${msg}`);
  logger.info('Tip: create a config file based on docker/ingest.config.example.yaml');
  process.exit(1);
}

let ingestConfig;
try {
  ingestConfig = loadIngestConfig(rawYaml);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`Invalid ingest config: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. App config + logger
// ---------------------------------------------------------------------------

const appConfig = await loadConfig();
reinitLogger({ level: appConfig.logLevel });

logger.info(
  {
    rules: ingestConfig.ingest.rules.length,
    intervalMs: ingestConfig.ingest.intervalMs,
    lokiUrl: ingestConfig.ingest.loki.url,
    llm: useRealLlm ? appConfig.llmProvider : 'mock',
  },
  'ingest-local: starting single-tick test',
);

// ---------------------------------------------------------------------------
// 3. Wire deps — use MockLLMProvider unless --real-llm
// ---------------------------------------------------------------------------

const redis = new Redis(appConfig.redisUrl, { lazyConnect: true });
try {
  await redis.connect();
  logger.info('Redis connected');
} catch (err) {
  logger.error({ err }, 'Redis connection failed — is it running? (pnpm setup:local)');
  process.exit(1);
}

const dedup = new RedisDeduplicationStore(redis);
const traces = new LokiTraceRepository(appConfig.lokiUrl ?? ingestConfig.ingest.loki.url);
const llm = useRealLlm
  ? createLLMProvider(appConfig.llmProvider, appConfig.llmApiKey, appConfig.llmModel)
  : new MockLLMProvider();
const notifier = createNotifier(appConfig);

const processIncidentUseCase = new ProcessIncidentUseCase({
  dedup,
  traces,
  llm,
  notifier,
  logger,
  dedupTtlSeconds: appConfig.dedupTtlSeconds,
});

const lokiClient = new LokiHttpClient({
  baseUrl: ingestConfig.ingest.loki.url,
  timeoutMs: ingestConfig.ingest.loki.timeoutMs,
  ...(ingestConfig.ingest.loki.auth ? { auth: ingestConfig.ingest.loki.auth } : {}),
});

// ---------------------------------------------------------------------------
// 4. Single tick — start() fires immediately, stop() drains it
// ---------------------------------------------------------------------------

const runner = new IngestRunner({
  config: ingestConfig,
  lokiClient,
  processIncidentUseCase,
  logger,
});

logger.info('Firing single tick...');
runner.start();
await runner.stop(); // waits for the in-flight tick to complete

logger.info('Single tick complete. Check Slack for any alerts triggered.');

// ---------------------------------------------------------------------------
// 5. Cleanup
// ---------------------------------------------------------------------------

await flushLoki();
await redis.quit();
process.exit(0);
