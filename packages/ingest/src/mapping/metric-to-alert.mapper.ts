import { createHash } from 'node:crypto';
import { AlertType } from '@junando/core';
import type { NormalizedAlert } from '@junando/core';
import type { PrometheusInstantResponse } from '../ports/prometheus-http-client.port.js';
import type { PrometheusRule } from '../config/ingest-config.schema.js';

// ---------------------------------------------------------------------------
// mapMetricResultToAlerts — pure function
// ---------------------------------------------------------------------------

/**
 * Map a Prometheus instant-query response to NormalizedAlert[].
 *
 * One alert is produced per series that passes the threshold condition.
 * Rule config is the authoritative source for constrained fields (alertType,
 * severity, service fallback). Metric labels provide context (service, labels).
 *
 * @param rule     - The matching prometheus rule from ingest config
 * @param response - Raw Prometheus instant-query response
 * @param nowMs    - Current time, Unix milliseconds (used for fingerprint window bucket)
 */
export function mapMetricResultToAlerts(
  rule: PrometheusRule,
  response: PrometheusInstantResponse,
  nowMs: number,
): NormalizedAlert[] {
  // Guard: only handle vector results
  if (response.data.resultType !== 'vector') {
    console.warn(
      `[mapMetricResultToAlerts] Unexpected resultType "${response.data.resultType}" for rule "${rule.name}" — skipping`,
    );
    return [];
  }

  const windowMs = rule.windowMs ?? 60_000;
  const windowBucketEnd = Math.floor(nowMs / windowMs) * windowMs;
  const comparator = rule.comparator ?? '>';
  const alerts: NormalizedAlert[] = [];

  for (const series of response.data.result) {
    const rawValue = series.value[1];
    const parsedValue = parseFloat(rawValue);

    // Skip non-finite values
    if (!isFinite(parsedValue)) {
      console.warn(
        `[mapMetricResultToAlerts] Non-finite value "${rawValue}" for rule "${rule.name}" service "${series.metric['service'] ?? rule.service}" — skipping`,
      );
      continue;
    }

    // Threshold evaluation
    if (!evaluate(parsedValue, comparator, rule.threshold)) {
      continue;
    }

    // Field mapping
    const serviceName = series.metric['service'] ?? rule.service;
    const fingerprint = computeFingerprint(rule.name, serviceName, windowBucketEnd);

    // Labels: pass-through, omit __name__
    const labels: Record<string, string> = { ...series.metric };
    delete labels['__name__'];

    // latencyMs only for latency_spike (AlertType.Warning)
    const latencyMs = rule.alertType === AlertType.Warning ? parsedValue : undefined;

    const alert: NormalizedAlert = {
      fingerprint,
      alertName: rule.name,
      status: 'firing',
      serviceName,
      alertType: rule.alertType,
      endpointPath: '',
      startsAt: new Date(nowMs).toISOString(),
      labels,
      annotations: {
        threshold: String(rule.threshold),
        comparator,
        value: rawValue,
      },
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    };

    alerts.push(alert);
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Comparator = '>' | '<' | '>=' | '<=';

function evaluate(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case '>':
      return value > threshold;
    case '<':
      return value < threshold;
    case '>=':
      return value >= threshold;
    case '<=':
      return value <= threshold;
  }
}

function computeFingerprint(ruleName: string, service: string, windowBucketEnd: number): string {
  const input = `${ruleName}:${service}:${windowBucketEnd}`;
  return createHash('sha256').update(input).digest('hex');
}
