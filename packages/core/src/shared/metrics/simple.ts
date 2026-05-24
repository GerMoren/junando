/**
 * @deprecated Use `packages/core/src/shared/metrics/index.ts` (prom-client registry) instead.
 * This module uses plain in-memory counters with no Prometheus support and will be removed.
 */
// Simple in-memory metrics without external dependencies
// These get reset when the server restarts

const metrics = {
  alertsReceived: 0,
  alertsProcessed: 0,
  alertsFiring: 0,
  alertsResolved: 0,
  webhooksTotal: 0,
  webhooksError: 0,
  llmCalls: 0,
  llmErrors: 0,
  slackNotifications: 0,
  slackErrors: 0,
  redisOps: 0,
  redisErrors: 0,
};

export function getMetrics() {
  return metrics;
}

export function incAlertReceived(status: 'firing' | 'resolved') {
  metrics.alertsReceived++;
  if (status === 'firing') metrics.alertsFiring++;
  else metrics.alertsResolved++;
  metrics.webhooksTotal++;
}

export function incAlertProcessed() {
  metrics.alertsProcessed++;
}

export function incWebhookError() {
  metrics.webhooksError++;
}

export function incLlmCall() {
  metrics.llmCalls++;
}

export function incLlmError() {
  metrics.llmErrors++;
}

export function incSlackNotify() {
  metrics.slackNotifications++;
}

export function incSlackError() {
  metrics.slackErrors++;
}

export function incRedisOp() {
  metrics.redisOps++;
}

export function incRedisError() {
  metrics.redisErrors++;
}

export function formatPrometheus(): string {
  const lines = [
    '# HELP junando_alerts_received_total Total alerts received',
    '# TYPE junando_alerts_received_total counter',
    `junando_alerts_received_total ${metrics.alertsReceived}`,
    '',
    '# HELP junando_alerts_firing Total firing alerts',
    '# TYPE junando_alerts_firing gauge',
    `junando_alerts_firing ${metrics.alertsFiring}`,
    '',
    '# HELP junando_alerts_resolved Total resolved alerts',
    '# TYPE junando_alerts_resolved gauge',
    `junando_alerts_resolved ${metrics.alertsResolved}`,
    '',
    '# HELP junando_webhooks_total Total webhook requests',
    '# TYPE junando_webhooks_total counter',
    `junando_webhooks_total ${metrics.webhooksTotal}`,
    '',
    '# HELP junando_webhooks_error Total webhook errors',
    '# TYPE junando_webhooks_error counter',
    `junando_webhooks_error ${metrics.webhooksError}`,
    '',
    '# HELP junando_llm_calls_total Total LLM inference calls',
    '# TYPE junando_llm_calls_total counter',
    `junando_llm_calls_total ${metrics.llmCalls}`,
    '',
    '# HELP junando_llm_errors_total Total LLM errors',
    '# TYPE junando_llm_errors_total counter',
    `junando_llm_errors_total ${metrics.llmErrors}`,
    '',
    '# HELP junando_slack_notifications_total Total Slack notifications',
    '# TYPE junando_slack_notifications_total counter',
    `junando_slack_notifications_total ${metrics.slackNotifications}`,
    '',
    '# HELP junando_slack_errors_total Total Slack errors',
    '# TYPE junando_slack_errors_total counter',
    `junando_slack_errors_total ${metrics.slackErrors}`,
    '',
    '# HELP junando_redis_ops_total Total Redis operations',
    '# TYPE junando_redis_ops_total counter',
    `junando_redis_ops_total ${metrics.redisOps}`,
    '',
    '# HELP junando_redis_errors_total Total Redis errors',
    '# TYPE junando_redis_errors_total counter',
    `junando_redis_errors_total ${metrics.redisErrors}`,
  ];
  return lines.join('\n');
}
