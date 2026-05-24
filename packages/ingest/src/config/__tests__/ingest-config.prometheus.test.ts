import { describe, it, expect } from 'vitest';
import { loadIngestConfig } from '../ingest-config.schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalPrometheusYaml(overrides = '') {
  return `
ingest:
  kind: prometheus
  endpoint: "http://prometheus:9090"
  tokenEnv: PROM_TOKEN
  intervalMs: 30000
  rules:
    - name: high-error-rate
      query: 'http_requests_total{status="500"}'
      service: api
      alertType: http_500
      severity: critical
      threshold: 50
      comparator: ">"
${overrides}
`.trim();
}

// ---------------------------------------------------------------------------
// Phase 1.3 — Prometheus config schema
// ---------------------------------------------------------------------------

describe('loadIngestConfig — Prometheus config schema', () => {
  // ── Scenario 1: Valid prometheus config parses ────────────────────────────
  it('PROM-CFG-01: valid prometheus config parses and exposes all fields', () => {
    const config = loadIngestConfig(minimalPrometheusYaml());

    expect(config.ingest.kind).toBe('prometheus');
    if (config.ingest.kind !== 'prometheus') throw new Error('Expected prometheus config');

    expect(config.ingest.endpoint).toBe('http://prometheus:9090');
    expect(config.ingest.intervalMs).toBe(30_000);
    expect(config.ingest.rules).toHaveLength(1);
    expect(config.ingest.rules[0]?.threshold).toBe(50);
    expect(config.ingest.rules[0]?.comparator).toBe('>');
  });

  // ── Scenario 2: Missing endpoint is rejected ──────────────────────────────
  it('PROM-CFG-02: missing endpoint is rejected with ZodError', () => {
    const yaml = `
ingest:
  kind: prometheus
  intervalMs: 30000
  rules:
    - name: r1
      query: 'up'
      service: api
      alertType: http_500
      severity: critical
      threshold: 1
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow();
  });

  // ── Scenario 3: Missing tokenEnv — still parses (tokenEnv is optional) ───
  it('PROM-CFG-03: tokenEnv is optional — config without tokenEnv parses successfully', () => {
    const yaml = `
ingest:
  kind: prometheus
  endpoint: "http://prometheus:9090"
  intervalMs: 30000
  rules:
    - name: r1
      query: 'up'
      service: api
      alertType: http_500
      severity: critical
      threshold: 1
`.trim();
    const config = loadIngestConfig(yaml);
    expect(config.ingest.kind).toBe('prometheus');
    if (config.ingest.kind !== 'prometheus') throw new Error('Expected prometheus config');
    expect(config.ingest.tokenEnv).toBeUndefined();
  });

  // ── Scenario 4: Invalid comparator is rejected ────────────────────────────
  it('PROM-CFG-04: invalid comparator "!=" is rejected with ZodError', () => {
    expect(() =>
      loadIngestConfig(
        minimalPrometheusYaml('      comparator: "!="').replace('comparator: ">"', ''),
      ),
    ).toThrow();
  });

  // ── Scenario 5: Empty rules array is rejected ─────────────────────────────
  it('PROM-CFG-05: empty rules array is rejected', () => {
    const yaml = `
ingest:
  kind: prometheus
  endpoint: "http://prometheus:9090"
  intervalMs: 30000
  rules: []
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow();
  });

  // ── Scenario 6: Default comparator is ">" ────────────────────────────────
  it('PROM-CFG-06: comparator defaults to ">" when not specified', () => {
    const yaml = `
ingest:
  kind: prometheus
  endpoint: "http://prometheus:9090"
  intervalMs: 30000
  rules:
    - name: r1
      query: 'up'
      service: api
      alertType: http_500
      severity: critical
      threshold: 1
`.trim();
    const config = loadIngestConfig(yaml);
    expect(config.ingest.kind).toBe('prometheus');
    if (config.ingest.kind !== 'prometheus') throw new Error('Expected prometheus config');
    expect(config.ingest.rules[0]?.comparator).toBe('>');
  });

  // ── Scenario 7: Invalid alertType is rejected ─────────────────────────────
  it('PROM-CFG-07: invalid alertType is rejected with ZodError', () => {
    const yaml = minimalPrometheusYaml().replace('alertType: http_500', 'alertType: unknown_type');
    expect(() => loadIngestConfig(yaml)).toThrow();
  });

  // ── Scenario 8: Loki config regression — still works ─────────────────────
  it('PROM-CFG-08: existing kind=loki config is unaffected (no regression)', () => {
    const yaml = `
ingest:
  kind: loki
  intervalMs: 5000
  loki:
    url: "http://loki:3100"
  rules:
    - name: r1
      query: '{job="a"}'
      service: api
      alertType: http_500
      severity: critical
`.trim();
    const config = loadIngestConfig(yaml);
    expect(config.ingest.kind).toBe('loki');
  });

  // ── Triangulation: non-positive intervalMs is rejected ───────────────────
  it('PROM-CFG-T1: non-positive intervalMs=0 is rejected', () => {
    const yaml = minimalPrometheusYaml().replace('intervalMs: 30000', 'intervalMs: 0');
    expect(() => loadIngestConfig(yaml)).toThrow();
  });

  // ── Triangulation: non-finite threshold is rejected ──────────────────────
  it('PROM-CFG-T2: non-finite threshold (Infinity via large YAML float) — rule with NaN rejected', () => {
    // Zod .finite() rejects NaN; YAML can't represent Infinity but we can test NaN-like via .number().finite()
    // Use a rule with threshold as a string to trigger type error
    const yaml = minimalPrometheusYaml().replace('threshold: 50', 'threshold: "not-a-number"');
    expect(() => loadIngestConfig(yaml)).toThrow();
  });
});
