import type { AlertmanagerPayload } from '../../../domain/entities/alert.js';

/**
 * db_outage — a shared database failure surfacing as errors across two
 * different services (orders-api and payments-worker). Expected outcome:
 * two clusters, two notifications, one per service.
 */
const NOW = '2026-05-23T20:05:00.000Z';
const ONE_HOUR_LATER = '2026-05-23T21:05:00.000Z';

export const dbOutagePayload: AlertmanagerPayload = {
  version: '4',
  groupKey: '{}:{alertname="DatabaseUnreachable"}',
  truncatedAlerts: 0,
  status: 'firing',
  receiver: 'junando',
  groupLabels: { alertname: 'DatabaseUnreachable' },
  commonLabels: { alertname: 'DatabaseUnreachable', severity: 'critical' },
  commonAnnotations: {
    summary: 'Primary Postgres instance is unreachable',
    runbook_url: 'https://example.com/runbooks/db-outage',
  },
  externalURL: 'http://alertmanager.local:9093',
  alerts: [
    // orders-api side
    ...[1, 2, 3].map((i) => ({
      status: 'firing' as const,
      labels: {
        alertname: 'DatabaseUnreachable',
        service: 'orders-api',
        endpoint: '/api/orders',
        error_type: 'db_connection_refused',
        severity: 'critical',
      },
      annotations: {
        summary: `orders-api cannot reach primary DB (sample ${i}/3)`,
      },
      startsAt: NOW,
      endsAt: ONE_HOUR_LATER,
      fingerprint: `db-outage-orders-${i}`,
    })),
    // payments-worker side
    ...[1, 2].map((i) => ({
      status: 'firing' as const,
      labels: {
        alertname: 'DatabaseUnreachable',
        service: 'payments-worker',
        endpoint: '/jobs/charge',
        error_type: 'db_connection_refused',
        severity: 'critical',
      },
      annotations: {
        summary: `payments-worker cannot reach primary DB (sample ${i}/2)`,
      },
      startsAt: NOW,
      endsAt: ONE_HOUR_LATER,
      fingerprint: `db-outage-payments-${i}`,
    })),
  ],
};
