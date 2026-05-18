import { describe, it, expect } from 'vitest';
import { mapLokiResultToAlerts } from '../log-to-alert.mapper.js';
import { AlertType } from '@junando/core';
import type { LokiQueryResponse } from '../../ports/loki-http-client.port.js';
import type { IngestRule } from '../../config/ingest-config.schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RULE: IngestRule = {
  name: 'high-error-rate',
  query: '{service="api"} |= "ERROR"',
  service: 'api',
  alertType: AlertType.Error,
  severity: 'critical',
  endpointPath: '/checkout',
  windowMs: 60_000,
};

const NOW_MS = 1_700_000_060_000; // milliseconds
const QUERY_START_MS = 1_700_000_000_000;

function makeLokiResponse(streams: LokiQueryResponse['data']['result']): LokiQueryResponse {
  return {
    status: 'success',
    data: { resultType: 'streams', result: streams },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapLokiResultToAlerts', () => {
  it('LKI-06-A: single stream → single valid NormalizedAlert', () => {
    const response = makeLokiResponse([
      {
        stream: { service: 'api', level: 'error' },
        values: [['1700000030000000000', 'ERROR something broke']],
      },
    ]);
    const alerts = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS);
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert.alertName).toBe('high-error-rate');
    expect(alert.alertType).toBe(AlertType.Error);
    expect(alert.endpointPath).toBe('/checkout');
    expect(alert.status).toBe('firing');
    expect(alert.annotations['message']).toBe('ERROR something broke');
    expect(alert.startsAt).toBe(new Date(QUERY_START_MS).toISOString());
  });

  it('LKI-06-A: fingerprint is deterministic for same rule/window', () => {
    const response = makeLokiResponse([
      {
        stream: { service: 'api', level: 'error' },
        values: [['1700000030000000000', 'ERROR broke']],
      },
    ]);
    const a1 = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS);
    const a2 = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS);
    expect(a1[0]?.fingerprint).toBe(a2[0]?.fingerprint);
  });

  it('fingerprint differs for different window buckets', () => {
    const response = makeLokiResponse([
      {
        stream: { service: 'api', level: 'error' },
        values: [['1700000030000000000', 'ERROR broke']],
      },
    ]);
    const a1 = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS);
    const a2 = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS + 120_000);
    expect(a1[0]?.fingerprint).not.toBe(a2[0]?.fingerprint);
  });

  it('multiple distinct services → one alert per service', () => {
    const response = makeLokiResponse([
      {
        stream: { service: 'api', level: 'error' },
        values: [['1700000030000000000', 'ERROR api broke']],
      },
      {
        stream: { service: 'worker', level: 'error' },
        values: [['1700000040000000000', 'ERROR worker broke']],
      },
    ]);
    const alerts = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS);
    expect(alerts).toHaveLength(2);
    const services = alerts.map((a) => a.serviceName).sort();
    expect(services).toEqual(['api', 'worker']);
  });

  it('empty result array → empty alerts array', () => {
    const response = makeLokiResponse([]);
    const alerts = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS);
    expect(alerts).toHaveLength(0);
  });

  it('labels filtered to { service, level }', () => {
    const response = makeLokiResponse([
      {
        stream: { service: 'api', level: 'error', pod: 'api-xyz', instance: '10.0.0.1' },
        values: [['1700000030000000000', 'ERROR broke']],
      },
    ]);
    const alerts = mapLokiResultToAlerts(RULE, response, QUERY_START_MS, NOW_MS);
    expect(alerts[0]?.labels).toEqual({ service: 'api', level: 'error' });
  });

  it('endpointPath is empty string when not set in rule', () => {
    const ruleNoEndpoint: IngestRule = { ...RULE, endpointPath: undefined };
    const response = makeLokiResponse([
      {
        stream: { service: 'api', level: 'error' },
        values: [['1700000030000000000', 'ERROR broke']],
      },
    ]);
    const alerts = mapLokiResultToAlerts(ruleNoEndpoint, response, QUERY_START_MS, NOW_MS);
    expect(alerts[0]?.endpointPath).toBe('');
  });
});
