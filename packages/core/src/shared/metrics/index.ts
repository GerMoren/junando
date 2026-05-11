import { Registry, Counter, Gauge, Histogram } from 'prom-client';

export const registry = new Registry();

export const alertsReceived = new Counter({
  name: 'junando_alerts_received_total',
  help: 'Total number of alerts received via webhook',
  labelNames: ['status'],
  registers: [registry],
});

export const webhookRequestsTotal = new Counter({
  name: 'junando_webhooks_total',
  help: 'Total number of webhook HTTP requests',
  labelNames: ['endpoint', 'status'],
  registers: [registry],
});

export const alertsProcessed = new Counter({
  name: 'junando_alerts_processed_total',
  help: 'Total number of alerts processed successfully',
  registers: [registry],
});

export const alertClusters = new Gauge({
  name: 'junando_alert_clusters',
  help: 'Current number of alert clusters',
  registers: [registry],
});

export const latency = new Histogram({
  name: 'junando_webhook_duration_seconds',
  help: 'Webhook request duration in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const llmInferenceDuration = new Histogram({
  name: 'junando_llm_inference_duration_seconds',
  help: 'LLM inference duration in seconds',
  buckets: [0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const llmInferenceTotal = new Counter({
  name: 'junando_llm_inference_total',
  help: 'Total number of LLM inference calls',
  labelNames: ['status'],
  registers: [registry],
});

/** Tracks inline pipeline failures in local dev mode. */
export const pipelineInlineFailuresTotal = new Counter({
  name: 'junando_pipeline_inline_failures_total',
  help: 'Total number of inline pipeline failures in dev mode',
  labelNames: ['reason'],
  registers: [registry],
});

/** Tracks Redis dedup fallback activations. */
export const dedupRedisFailoverTotal = new Counter({
  name: 'junando_dedup_redis_failover_total',
  help: 'Total number of Redis dedup fallback activations',
  registers: [registry],
});
