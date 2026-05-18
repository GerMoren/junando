import { describe, it, expect } from 'vitest';
import { loadIngestConfig } from '../ingest-config.schema.js';
import { AlertType } from '@junando/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalValidYaml(overrides = '') {
  return `
ingest:
  intervalMs: 5000
  loki:
    url: "http://loki:3100"
    timeoutMs: 3000
  rules:
    - name: high-error-rate
      query: '{service="api"} |= "ERROR"'
      service: api
      alertType: http_500
      severity: critical
${overrides}
`.trim();
}

// ---------------------------------------------------------------------------
// CFG-01: Fail-fast on missing or invalid config
// ---------------------------------------------------------------------------

describe('loadIngestConfig — CFG-01: fail-fast validation', () => {
  it('CFG-01-A: throws when YAML string is empty / not provided', () => {
    expect(() => loadIngestConfig('')).toThrow();
  });

  it('CFG-01-C: throws on malformed YAML', () => {
    expect(() => loadIngestConfig('ingest:\n  rules: [{name: [bad: yaml')).toThrow();
  });

  it('CFG-01-D: throws a Zod error when a required field is missing (rule.query)', () => {
    const yaml = `
ingest:
  loki:
    url: "http://loki:3100"
  rules:
    - name: missing-query
      service: api
      alertType: http_500
      severity: critical
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow(/query/i);
  });

  it('CFG-01-E: throws when loki.url is an empty string', () => {
    const yaml = `
ingest:
  loki:
    url: ""
  rules:
    - name: r1
      query: '{job="a"}'
      service: api
      alertType: http_500
      severity: critical
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CFG-02: Valid config returns frozen typed object
// ---------------------------------------------------------------------------

describe('loadIngestConfig — CFG-02: valid config', () => {
  it('CFG-02-A: applies default intervalMs (30000) and timeoutMs (10000)', () => {
    const yaml = `
ingest:
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
    expect(config.ingest.intervalMs).toBe(30_000);
    expect(config.ingest.loki.timeoutMs).toBe(10_000);
  });

  it('CFG-02-B: returned object is frozen', () => {
    const config = loadIngestConfig(minimalValidYaml());
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('CFG-02-C: throws when two rules share the same name', () => {
    const yaml = `
ingest:
  loki:
    url: "http://loki:3100"
  rules:
    - name: same-name
      query: '{job="a"}'
      service: api
      alertType: http_500
      severity: critical
    - name: same-name
      query: '{job="b"}'
      service: api
      alertType: http_500
      severity: critical
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow(/duplicate/i);
  });
});

// ---------------------------------------------------------------------------
// CFG-03: Schema shape contract
// ---------------------------------------------------------------------------

describe('loadIngestConfig — CFG-03: schema shape contract', () => {
  it('CFG-03-A: throws when alertType is an invalid enum value', () => {
    const yaml = `
ingest:
  loki:
    url: "http://loki:3100"
  rules:
    - name: r1
      query: '{job="a"}'
      service: api
      alertType: unknown_type
      severity: critical
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow();
  });

  it('CFG-03-B: auth block with tokenEnv is accepted (env var name ref, not literal)', () => {
    const yaml = `
ingest:
  loki:
    url: "http://loki:3100"
    auth:
      type: bearer
      tokenEnv: LOKI_TOKEN
  rules:
    - name: r1
      query: '{job="a"}'
      service: api
      alertType: http_500
      severity: critical
`.trim();
    // Should NOT throw — tokenEnv is an env var reference, not a literal secret
    const config = loadIngestConfig(yaml);
    expect(config.ingest.loki.auth).toBeDefined();
  });

  it('CFG-03: valid config resolves alertType to AlertType enum', () => {
    const config = loadIngestConfig(minimalValidYaml());
    expect(config.ingest.rules[0]?.alertType).toBe(AlertType.Error);
  });

  it('CFG-03: valid config exposes all rule fields', () => {
    const config = loadIngestConfig(minimalValidYaml());
    const rule = config.ingest.rules[0];
    expect(rule).toBeDefined();
    if (!rule) return;
    expect(rule.name).toBe('high-error-rate');
    expect(rule.service).toBe('api');
    expect(rule.severity).toBe('critical');
  });
});
