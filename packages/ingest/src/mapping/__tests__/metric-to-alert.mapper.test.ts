import { describe, it, expect, vi } from 'vitest';
import { mapMetricResultToAlerts } from '../metric-to-alert.mapper.js';
import { AlertType } from '@junando/core';
import type { PrometheusInstantResponse } from '../../ports/prometheus-http-client.port.js';
import type { PrometheusRule } from '../../config/ingest-config.schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_MS = 1_700_000_060_000;
const WINDOW_MS = 60_000;
// windowBucketEnd = Math.floor(NOW_MS / 60000) * 60000 = 1_700_000_060_000
const WINDOW_BUCKET_END = Math.floor(NOW_MS / WINDOW_MS) * WINDOW_MS;

const BASE_RULE: PrometheusRule = {
  name: 'high-error-rate',
  query: 'sum(rate(http_errors_total[5m]))',
  service: 'api',
  alertType: AlertType.Error,
  severity: 'critical',
  threshold: 50,
  comparator: '>',
};

function makeResponse(
  values: Array<{ metric?: Record<string, string>; value: string }>,
): PrometheusInstantResponse {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: values.map((v) => ({
        metric: v.metric ?? { service: 'api' },
        value: [1_700_000_060, v.value],
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Threshold Evaluation
// ---------------------------------------------------------------------------

describe('mapMetricResultToAlerts — threshold evaluation', () => {
  it('PME-01: single series above threshold fires', () => {
    const response = makeResponse([{ value: '75' }]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.status).toBe('firing');
    expect(alerts[0]!.annotations['threshold']).toBe('50');
    expect(alerts[0]!.annotations['comparator']).toBe('>');
    expect(alerts[0]!.annotations['value']).toBe('75');
  });

  it('PME-02: series below threshold with > does not fire', () => {
    const response = makeResponse([{ value: '30' }]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts).toHaveLength(0);
  });

  it('PME-03: comparator < — value below threshold fires', () => {
    const rule: PrometheusRule = { ...BASE_RULE, threshold: 10, comparator: '<' };
    const response = makeResponse([{ value: '5' }]);
    const alerts = mapMetricResultToAlerts(rule, response, NOW_MS);
    expect(alerts).toHaveLength(1);
  });

  it('PME-04: comparator < — value above threshold does not fire', () => {
    const rule: PrometheusRule = { ...BASE_RULE, threshold: 10, comparator: '<' };
    const response = makeResponse([{ value: '15' }]);
    const alerts = mapMetricResultToAlerts(rule, response, NOW_MS);
    expect(alerts).toHaveLength(0);
  });

  it('PME-05: comparator >= — value at boundary fires', () => {
    const rule: PrometheusRule = { ...BASE_RULE, threshold: 50, comparator: '>=' };
    const response = makeResponse([{ value: '50' }]);
    const alerts = mapMetricResultToAlerts(rule, response, NOW_MS);
    expect(alerts).toHaveLength(1);
  });

  it('PME-06: non-finite value (NaN) is skipped with a logged warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = makeResponse([{ value: 'NaN' }]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('PME-06b: non-finite value (Infinity) is skipped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = makeResponse([{ value: 'Infinity' }]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('PME-guard: resultType !== vector returns [] with logged warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const badResponse = {
      status: 'success' as const,
      data: { resultType: 'scalar' as unknown as 'vector', result: [] },
    };
    const alerts = mapMetricResultToAlerts(BASE_RULE, badResponse, NOW_MS);
    expect(alerts).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

describe('mapMetricResultToAlerts — fingerprint', () => {
  it('PME-07: two series in same vector have distinct fingerprints', () => {
    const response = makeResponse([
      { metric: { service: 'payments' }, value: '75' },
      { metric: { service: 'orders' }, value: '75' },
    ]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.fingerprint).not.toBe(alerts[1]!.fingerprint);
  });

  it('PME-08: same series same window bucket → same fingerprint', () => {
    const r1 = makeResponse([{ value: '75' }]);
    const r2 = makeResponse([{ value: '75' }]);
    const a1 = mapMetricResultToAlerts(BASE_RULE, r1, NOW_MS);
    const a2 = mapMetricResultToAlerts(BASE_RULE, r2, NOW_MS + 5_000); // same bucket
    expect(a1[0]!.fingerprint).toBe(a2[0]!.fingerprint);
  });

  it('PME-09: same series different window bucket → different fingerprint', () => {
    const r1 = makeResponse([{ value: '75' }]);
    const r2 = makeResponse([{ value: '75' }]);
    const a1 = mapMetricResultToAlerts(BASE_RULE, r1, NOW_MS);
    const a2 = mapMetricResultToAlerts(BASE_RULE, r2, NOW_MS + WINDOW_MS); // next bucket
    expect(a1[0]!.fingerprint).not.toBe(a2[0]!.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// Field Mapping
// ---------------------------------------------------------------------------

describe('mapMetricResultToAlerts — field mapping', () => {
  it('PME-10: metric.service label present → used as serviceName, __name__ omitted from labels', () => {
    const response = makeResponse([
      { metric: { service: 'payments', __name__: 'http_errors' }, value: '75' },
    ]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts[0]!.serviceName).toBe('payments');
    expect(alerts[0]!.labels['__name__']).toBeUndefined();
  });

  it('PME-11: metric.service missing → falls back to rule.service', () => {
    const response = makeResponse([{ metric: { instance: 'pod-1' }, value: '75' }]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts[0]!.serviceName).toBe('api');
  });

  it('PME-12: latency_spike alertType populates latencyMs', () => {
    const rule: PrometheusRule = { ...BASE_RULE, alertType: AlertType.Warning, threshold: 200 };
    const response = makeResponse([{ value: '320' }]);
    const alerts = mapMetricResultToAlerts(rule, response, NOW_MS);
    expect(alerts[0]!.latencyMs).toBe(320);
  });

  it('PME-13: non-latency alertType — latencyMs absent', () => {
    const response = makeResponse([{ value: '75' }]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts[0]!.latencyMs).toBeUndefined();
  });

  it('PME-14: endpointPath is always empty string', () => {
    const response = makeResponse([{ value: '75' }]);
    const alerts = mapMetricResultToAlerts(BASE_RULE, response, NOW_MS);
    expect(alerts[0]!.endpointPath).toBe('');
  });

  it('PME-15: windowBucketEnd uses Math.floor (spec formula)', () => {
    // windowBucketEnd = Math.floor(NOW_MS / windowMs) * windowMs
    const rule: PrometheusRule = { ...BASE_RULE, windowMs: WINDOW_MS };
    const response = makeResponse([{ value: '75' }]);
    const a1 = mapMetricResultToAlerts(rule, response, WINDOW_BUCKET_END);
    const a2 = mapMetricResultToAlerts(rule, response, WINDOW_BUCKET_END + WINDOW_MS);
    expect(a1[0]!.fingerprint).not.toBe(a2[0]!.fingerprint);
  });
});
