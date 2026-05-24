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
  labelNames: ['result'],
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
  labelNames: ['status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [registry],
});

export const llmInferenceDuration = new Histogram({
  name: 'junando_llm_inference_duration_seconds',
  help: 'LLM inference duration in seconds',
  labelNames: ['model'],
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

/** Tracks new alert clusters (dedup: first-time fingerprint). */
export const dedupNew = new Counter({
  name: 'junando_dedup_new_total',
  help: 'Total number of new alert clusters (not yet seen)',
  labelNames: ['source'],
  registers: [registry],
});

/** Tracks duplicate alert clusters (dedup: fingerprint already seen). */
export const dedupDuplicate = new Counter({
  name: 'junando_dedup_duplicate_total',
  help: 'Total number of duplicate alert clusters skipped by dedup',
  labelNames: ['source'],
  registers: [registry],
});

/** Tracks outbound notification attempts by channel and outcome. */
export const notificationsTotal = new Counter({
  name: 'junando_notifications_total',
  help: 'Total number of notification attempts',
  labelNames: ['channel', 'outcome'],
  registers: [registry],
});

/** Tracks approximate number of unprocessed SQS messages (queue lag). */
export const sqsQueueLag = new Gauge({
  name: 'junando_sqs_queue_lag',
  help: 'Approximate number of unprocessed messages in the SQS queue',
  labelNames: ['queue_name'],
  registers: [registry],
});
