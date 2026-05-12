import { describe, it, expect } from 'vitest';
import { normalizePayload } from '../normalize-payload.js';
import type { AlertmanagerPayload } from '../../../domain/entities/alert.js';
import { AlertType } from '../../../shared/constants.js';

describe('normalizePayload', () => {
  it('maps Alertmanager payload to NormalizedAlert[] and filters out resolved alerts', () => {
    const payload: AlertmanagerPayload = {
      version: '4',
      groupKey: 'test',
      status: 'firing',
      receiver: 'test',
      groupLabels: {},
      commonLabels: {},
      commonAnnotations: {},
      externalURL: 'http://localhost',
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'HighErrorRate',
            service: 'checkout',
            error_type: 'http_500',
            endpoint: '/pay',
            trace_id: 't1',
            latency_ms: '500',
          },
          annotations: {},
          startsAt: new Date('2026-05-08T10:00:00Z'),
          endsAt: new Date('2026-05-08T10:05:00Z'),
          fingerprint: 'fp1',
        },
        {
          status: 'resolved',
          labels: {},
          annotations: {},
          startsAt: new Date('2026-05-08T10:00:00Z'),
          endsAt: new Date('2026-05-08T10:05:00Z'),
          fingerprint: 'fp2',
        },
        {
          status: 'firing',
          labels: {
            job: 'background-worker',
          },
          annotations: {
            trace_id: 't3',
          },
          startsAt: new Date('2026-05-08T10:00:00Z'),
          endsAt: new Date('2026-05-08T10:05:00Z'),
          fingerprint: 'fp3',
        },
      ],
    };

    const normalized = normalizePayload(payload);

    expect(normalized).toHaveLength(2);

    expect(normalized[0]).toEqual(
      expect.objectContaining({
        alertName: 'HighErrorRate',
        status: 'firing',
        serviceName: 'checkout',
        alertType: AlertType.Error,
        endpointPath: '/pay',
        traceId: 't1',
        latencyMs: 500,
        fingerprint: 'fp1',
      }),
    );

    expect(normalized[1]).toEqual(
      expect.objectContaining({
        alertName: 'unknown',
        serviceName: 'background-worker',
        alertType: AlertType.Error,
        endpointPath: '/',
        traceId: 't3',
        latencyMs: undefined,
        fingerprint: 'fp3',
      }),
    );

  });
});
