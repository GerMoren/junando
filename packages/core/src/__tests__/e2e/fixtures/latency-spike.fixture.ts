import type { AlertmanagerPayload } from '../../../domain/entities/alert.js';

/**
 * latency_spike — a single service degrading. Five firing alerts for the
 * same alertname/service/endpoint with rising latency. Expected outcome:
 * one cluster, one notification.
 */
const NOW = '2026-05-23T20:00:00.000Z';
const ONE_HOUR_LATER = '2026-05-23T21:00:00.000Z';

export const latencySpikePayload: AlertmanagerPayload = {
  version: '4',
  groupKey: '{}:{alertname="HighLatency",service="checkout-api"}',
  truncatedAlerts: 0,
  status: 'firing',
  receiver: 'junando',
  groupLabels: { alertname: 'HighLatency', service: 'checkout-api' },
  commonLabels: { alertname: 'HighLatency', service: 'checkout-api', severity: 'critical' },
  commonAnnotations: { summary: 'p99 latency above SLO on /api/checkout' },
  externalURL: 'http://alertmanager.local:9093',
  alerts: [120, 240, 360, 480, 600].map((latencyMs, i) => ({
    status: 'firing' as const,
    labels: {
      alertname: 'HighLatency',
      service: 'checkout-api',
      endpoint: '/api/checkout',
      error_type: 'latency',
      severity: 'critical',
      latency_ms: String(latencyMs),
    },
    annotations: {
      summary: `Latency ${latencyMs}ms exceeds 100ms SLO (sample ${i + 1}/5)`,
    },
    startsAt: NOW,
    endsAt: ONE_HOUR_LATER,
    fingerprint: `latency-spike-${i}`,
  })),
};
