/**
 * process-incident.factory.ts
 * Composition factory for ProcessIncidentUseCase.
 *
 * Centralizes all dependency wiring so that any script entrypoint
 * (worker-server, ingest-server, etc.) can create a fully-wired use case
 * with a single call.
 */
import {
  createLLMProvider,
  createNotifier,
  LokiTraceRepository,
  metrics,
  ProcessIncidentUseCase,
  RedisDeduplicationStore,
} from '../../packages/core/src/index.js';
import type { Config, Logger } from '../../packages/core/src/index.js';
import { Redis } from 'ioredis';

export interface ProcessIncidentDeps {
  config: Config;
  logger: Logger;
}

/**
 * Creates a fully-wired ProcessIncidentUseCase from config and logger.
 *
 * Wiring mirrors packages/worker/src/handler.ts#getUseCase() exactly.
 * No behavior change — this is a pure extraction.
 *
 * @throws {Error} if config or logger is missing
 */
export function createProcessIncidentUseCase(
  deps: ProcessIncidentDeps,
): ProcessIncidentUseCase {
  if (!deps?.config) {
    throw new Error('createProcessIncidentUseCase: config is required');
  }
  if (!deps?.logger) {
    throw new Error('createProcessIncidentUseCase: logger is required');
  }

  const { config, logger } = deps;

  const redis = new Redis(config.redisUrl, { lazyConnect: true });
  const dedup = new RedisDeduplicationStore(redis);
  const traces = new LokiTraceRepository(config.lokiUrl ?? '');
  const llm = createLLMProvider(config.llmProvider, config.llmApiKey, config.llmModel);
  const notifier = createNotifier(config);

  return new ProcessIncidentUseCase({
    dedup,
    traces,
    llm,
    notifier,
    logger,
    dedupTtlSeconds: config.dedupTtlSeconds,
    onClustersBuilt: (count) => metrics.alertClusters.set(count),
  });
}
