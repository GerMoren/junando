import { describe, it, expect } from 'vitest';
import { loadIngestConfig } from '../ingest-config.schema.js';
import { AlertType } from '@junando/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalLegacyLokiYaml(overrides = '') {
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

function minimalExplicitLokiYaml(overrides = '') {
  return `
ingest:
  kind: loki
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

function minimalSqsYaml(overrides = '') {
  return `
ingest:
  kind: sqs
  sqs:
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors"
${overrides}
  mapper:
    kind: cenco-error-v1
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
  kind: loki
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
  kind: loki
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

  it('CFG-01-F: throws when sqs.queueUrl is missing', () => {
    const yaml = `
ingest:
  kind: sqs
  sqs:
    waitTimeSeconds: 20
    visibilityTimeoutSeconds: 60
    batchSize: 10
    maxInFlight: 20
`.trim();

    expect(() => loadIngestConfig(yaml)).toThrow(/queueUrl/i);
  });

  it('CFG-01-G: throws when sqs.batchSize exceeds SQS max of 10', () => {
    expect(() => loadIngestConfig(minimalSqsYaml('    batchSize: 11'))).toThrow(/batchSize/i);
  });

  it('CFG-01-H: throws when sqs.maxInFlight is non-positive', () => {
    expect(() => loadIngestConfig(minimalSqsYaml('    maxInFlight: 0'))).toThrow(/maxInFlight/i);
  });

  it('CFG-01-I: throws when sqs.waitTimeSeconds exceeds 20', () => {
    expect(() => loadIngestConfig(minimalSqsYaml('    waitTimeSeconds: 21'))).toThrow(
      /waitTimeSeconds/i,
    );
  });

  it('CFG-01-J: throws when sqs mapper is missing', () => {
    const yaml = `
ingest:
  kind: sqs
  sqs:
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors"
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow(/mapper/i);
  });

  it('CFG-01-K: throws when sqs mapper.kind is empty', () => {
    const yaml = `
ingest:
  kind: sqs
  sqs:
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors"
  mapper:
    kind: ""
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CFG-02: Valid config returns frozen typed object
// ---------------------------------------------------------------------------

describe('loadIngestConfig — CFG-02: valid config', () => {
  it('CFG-02-A: legacy Loki config still loads and normalizes to kind=loki', () => {
    const config = loadIngestConfig(minimalLegacyLokiYaml());

    expect(config.ingest.kind).toBe('loki');
    if (config.ingest.kind !== 'loki') {
      throw new Error('Expected loki config');
    }

    expect(config.ingest.intervalMs).toBe(5000);
    expect(config.ingest.loki.timeoutMs).toBe(3000);
  });

  it('CFG-02-B: explicit kind=loki applies default intervalMs (30000) and timeoutMs (10000)', () => {
    const yaml = `
ingest:
  kind: loki
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
    if (config.ingest.kind !== 'loki') {
      throw new Error('Expected loki config');
    }

    expect(config.ingest.intervalMs).toBe(30_000);
    expect(config.ingest.loki.timeoutMs).toBe(10_000);
  });

  it('CFG-02-C: returned object is frozen', () => {
    const config = loadIngestConfig(minimalLegacyLokiYaml());
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('CFG-02-D: throws when two rules share the same name', () => {
    const yaml = `
ingest:
  kind: loki
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

  it('CFG-02-E: valid kind=sqs config loads with defaults intact', () => {
    const yaml = `
ingest:
  kind: sqs
  sqs:
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors"
  mapper:
    kind: cenco-error-v1
`.trim();
    const config = loadIngestConfig(yaml);

    expect(config.ingest.kind).toBe('sqs');
    if (config.ingest.kind !== 'sqs') {
      throw new Error('Expected sqs config');
    }

    expect(config.ingest.sqs.waitTimeSeconds).toBe(20);
    expect(config.ingest.sqs.visibilityTimeoutSeconds).toBe(60);
    expect(config.ingest.sqs.batchSize).toBe(10);
    expect(config.ingest.sqs.maxInFlight).toBe(20);
  });

  it('CFG-02-F: valid kind=sqs config accepts an optional endpointUrl for local-dev runtimes', () => {
    const config = loadIngestConfig(minimalSqsYaml('    endpointUrl: "http://localhost:4566"'));

    expect(config.ingest.kind).toBe('sqs');
    if (config.ingest.kind !== 'sqs') {
      throw new Error('Expected sqs config');
    }

    expect((config.ingest.sqs as { endpointUrl?: string }).endpointUrl).toBe(
      'http://localhost:4566',
    );
  });

  it('CFG-02-G: valid kind=sqs config accepts an optional opensearch block', () => {
    const yaml = `
ingest:
  kind: sqs
  sqs:
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors"
  opensearch:
    endpoint: "https://search-cenco.us-east-1.es.amazonaws.com"
    indexName: "cenco-traceability"
    region: "us-east-1"
  mapper:
    kind: cenco-error-v1
`.trim();
    const config = loadIngestConfig(yaml);

    expect(config.ingest.kind).toBe('sqs');
    if (config.ingest.kind !== 'sqs') {
      throw new Error('Expected sqs config');
    }

    expect(config.ingest.opensearch).toEqual({
      endpoint: 'https://search-cenco.us-east-1.es.amazonaws.com',
      indexName: 'cenco-traceability',
      region: 'us-east-1',
    });
  });

  it('CFG-02-H: opensearch block is optional on sqs config', () => {
    const config = loadIngestConfig(
      `
ingest:
  kind: sqs
  sqs:
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors"
  mapper:
    kind: cenco-error-v1
`.trim(),
    );

    if (config.ingest.kind !== 'sqs') throw new Error('Expected sqs config');
    expect(config.ingest.opensearch).toBeUndefined();
  });

  it('CFG-02-J: valid kind=sqs config includes the mapper.kind field', () => {
    const config = loadIngestConfig(minimalSqsYaml());
    if (config.ingest.kind !== 'sqs') throw new Error('Expected sqs config');
    expect(config.ingest.mapper).toEqual({ kind: 'cenco-error-v1' });
  });

  it('CFG-02-I: opensearch block rejects an invalid endpoint URL', () => {
    const yaml = `
ingest:
  kind: sqs
  sqs:
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors"
  opensearch:
    endpoint: "not-a-url"
    indexName: "cenco-traceability"
    region: "us-east-1"
`.trim();
    expect(() => loadIngestConfig(yaml)).toThrow(/endpoint/i);
  });
});

// ---------------------------------------------------------------------------
// CFG-03: Schema shape contract
// ---------------------------------------------------------------------------

describe('loadIngestConfig — CFG-03: schema shape contract', () => {
  it('CFG-03-A: throws when alertType is an invalid enum value', () => {
    const yaml = `
ingest:
  kind: loki
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
  kind: loki
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
    const config = loadIngestConfig(yaml);

    expect(config.ingest.kind).toBe('loki');
    if (config.ingest.kind !== 'loki') {
      throw new Error('Expected loki config');
    }

    expect(config.ingest.loki.auth).toBeDefined();
  });

  it('CFG-03-C: valid config resolves alertType to AlertType enum', () => {
    const config = loadIngestConfig(minimalExplicitLokiYaml());

    expect(config.ingest.kind).toBe('loki');
    if (config.ingest.kind !== 'loki') {
      throw new Error('Expected loki config');
    }

    expect(config.ingest.rules[0]?.alertType).toBe(AlertType.Error);
  });

  it('CFG-03-D: valid config exposes all Loki rule fields', () => {
    const config = loadIngestConfig(minimalExplicitLokiYaml());

    expect(config.ingest.kind).toBe('loki');
    if (config.ingest.kind !== 'loki') {
      throw new Error('Expected loki config');
    }

    const rule = config.ingest.rules[0];
    expect(rule).toBeDefined();
    if (!rule) return;
    expect(rule.name).toBe('high-error-rate');
    expect(rule.service).toBe('api');
    expect(rule.severity).toBe('critical');
  });
});
