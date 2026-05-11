import { describe, it, expect } from 'vitest';
import { ClusteringService } from '../clustering.service.js';
import type { NormalizedAlert } from '../../entities/alert.js';
import { AlertType } from '../../../shared/constants.js';

function makeAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    alertName: 'HighErrorRate',
    serviceName: 'checkout',
    alertType: AlertType.Error,
    endpointPath: '/pay',
    status: 'firing',
    startsAt: new Date('2026-05-08T10:00:00Z').toISOString(),
    labels: {},
    annotations: {},
    ...overrides,
  };
}

describe('ClusteringService', () => {
  const service = new ClusteringService();

  it('groups alerts with the same fingerprint into a single cluster', () => {
    const baseAlert = makeAlert({
      traceId: 'trace-1',
      latencyMs: 100,
      startsAt: new Date('2026-05-08T10:00:00Z').toISOString(),
    });

    const alert2 = makeAlert({
      alertName: 'Alert2',
      traceId: 'trace-2',
      latencyMs: 500,
      startsAt: new Date('2026-05-08T10:01:00Z').toISOString(),
    });

    const alert3 = makeAlert({
      alertName: 'Alert3',
      serviceName: 'auth',
      traceId: 'trace-3',
      latencyMs: 50,
      startsAt: new Date('2026-05-08T10:02:00Z').toISOString(),
    });

    const clusters = service.buildClusters([baseAlert, alert2, alert3]);

    expect(clusters.length).toBe(2);

    const checkoutCluster = clusters.find((c) => c.serviceName === 'checkout');
    expect(checkoutCluster).toBeDefined();
    expect(checkoutCluster?.alertCount).toBe(2);
    expect(checkoutCluster?.alertType).toBe(AlertType.Error);
    expect(checkoutCluster?.representativeTraceIds).toEqual(['trace-1', 'trace-2']);
    expect(checkoutCluster?.latencyP99Ms).toBe(500);

    const authCluster = clusters.find((c) => c.serviceName === 'auth');
    expect(authCluster?.alertCount).toBe(1);
    expect(authCluster?.representativeTraceIds).toEqual(['trace-3']);
  });

  it('returns empty array when given no alerts', () => {
    expect(service.buildClusters([])).toEqual([]);
  });
});
