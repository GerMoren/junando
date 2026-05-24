import { describe, it, expect, vi, afterEach } from 'vitest';
import { PrometheusIngestRunner } from '../prometheus-ingest-runner.js';
import { AlertType } from '@junando/core';
import type { PrometheusHttpClientPort, PrometheusInstantResponse } from '../../ports/prometheus-http-client.port.js';
import type { PrometheusIngestConfig } from '../../config/ingest-config.schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROM_SUCCESS: PrometheusInstantResponse = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [
      {
        metric: { service: 'api' },
        value: [1_700_000_060, '75'],
      },
    ],
  },
};

const PROM_EMPTY: PrometheusInstantResponse = {
  status: 'success',
  data: { resultType: 'vector', result: [] },
};

const NOW_MS = 1_700_000_060_000;

function makeConfig(intervalMs = 60_000): PrometheusIngestConfig {
  return {
    ingest: {
      kind: 'prometheus',
      endpoint: 'http://prom:9090',
      intervalMs,
      rules: [
        {
          name: 'rule-one',
          query: 'sum(rate(http_errors_total[5m]))',
          service: 'api',
          alertType: AlertType.Error,
          severity: 'critical',
          threshold: 50,
          comparator: '>',
        },
      ],
    },
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeUseCase() {
  return { execute: vi.fn<[unknown[], string], Promise<void>>().mockResolvedValue(undefined) };
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrometheusIngestRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('PRR-01: happy path — single series above threshold calls useCase.execute once', async () => {
    vi.useFakeTimers();
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockResolvedValue(PROM_SUCCESS) };
    const useCase = makeUseCase();
    const logger = makeLogger();
    const now = vi.fn().mockReturnValue(NOW_MS);

    const runner = new PrometheusIngestRunner({ config: makeConfig(), promClient: client, processIncidentUseCase: useCase, logger }, { now });
    runner.start();
    await flushMicrotasks();

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    const [alerts, correlationId] = useCase.execute.mock.calls[0]!;
    expect((alerts as unknown[]).length).toBe(1);
    expect(typeof correlationId).toBe('string');
    expect(correlationId).toMatch(/^prometheus-0-/);

    await runner.stop();
  });

  it('PRR-02: empty vector — useCase.execute NOT called', async () => {
    vi.useFakeTimers();
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockResolvedValue(PROM_EMPTY) };
    const useCase = makeUseCase();
    const logger = makeLogger();

    const runner = new PrometheusIngestRunner({ config: makeConfig(), promClient: client, processIncidentUseCase: useCase, logger }, { now: () => NOW_MS });
    runner.start();
    await flushMicrotasks();

    expect(useCase.execute).not.toHaveBeenCalled();
    await runner.stop();
  });

  it('PRR-03: upstream 5xx — error logged, loop continues (no throw)', async () => {
    vi.useFakeTimers();
    const httpError = new Error('HTTP 500');
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockRejectedValue(httpError) };
    const useCase = makeUseCase();
    const logger = makeLogger();

    const runner = new PrometheusIngestRunner({ config: makeConfig(), promClient: client, processIncidentUseCase: useCase, logger }, { now: () => NOW_MS });
    runner.start();
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalled();
    expect(useCase.execute).not.toHaveBeenCalled();
    await runner.stop();
  });

  it('PRR-04: parse error — error logged, loop continues', async () => {
    vi.useFakeTimers();
    const parseError = new Error('Unexpected token');
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockRejectedValue(parseError) };
    const useCase = makeUseCase();
    const logger = makeLogger();

    const runner = new PrometheusIngestRunner({ config: makeConfig(), promClient: client, processIncidentUseCase: useCase, logger }, { now: () => NOW_MS });
    runner.start();
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalled();
    await runner.stop();
  });

  it('PRR-05: lagging rule is skipped on next tick', async () => {
    vi.useFakeTimers();
    let resolveQuery!: (v: PrometheusInstantResponse) => void;
    const slowPromise = new Promise<PrometheusInstantResponse>((res) => { resolveQuery = res; });
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockReturnValueOnce(slowPromise).mockResolvedValue(PROM_EMPTY) };
    const useCase = makeUseCase();
    const logger = makeLogger();
    const config = makeConfig(100);

    const runner = new PrometheusIngestRunner({ config, promClient: client, processIncidentUseCase: useCase, logger }, { now: () => NOW_MS });
    runner.start();
    await flushMicrotasks();

    // Advance timer to trigger 2nd tick — rule still in-flight
    vi.advanceTimersByTime(100);
    await flushMicrotasks();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rule-one'));

    resolveQuery(PROM_EMPTY);
    await runner.stop();
  });

  it('PRR-06: useCase.execute throws — error logged, runner does not crash', async () => {
    vi.useFakeTimers();
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockResolvedValue(PROM_SUCCESS) };
    const useCase = { execute: vi.fn().mockRejectedValue(new Error('use case boom')) };
    const logger = makeLogger();

    const runner = new PrometheusIngestRunner({ config: makeConfig(), promClient: client, processIncidentUseCase: useCase, logger }, { now: () => NOW_MS });
    runner.start();
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalled();
    await runner.stop();
  });

  it('PRR-07: correlation ID format is prometheus-{ruleIndex}-{timestamp}', async () => {
    vi.useFakeTimers();
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockResolvedValue(PROM_SUCCESS) };
    const useCase = makeUseCase();
    const logger = makeLogger();
    const now = vi.fn().mockReturnValue(NOW_MS);

    const runner = new PrometheusIngestRunner({ config: makeConfig(), promClient: client, processIncidentUseCase: useCase, logger }, { now });
    runner.start();
    await flushMicrotasks();

    const correlationId = useCase.execute.mock.calls[0]![1] as string;
    expect(correlationId).toBe(`prometheus-0-${NOW_MS}`);
    await runner.stop();
  });

  it('PRR-08: clock injection — nowMs comes from opts.now, not Date.now', async () => {
    vi.useFakeTimers();
    const FIXED_NOW = 9_999_999_000;
    const client: PrometheusHttpClientPort = { queryInstant: vi.fn().mockResolvedValue(PROM_SUCCESS) };
    const useCase = makeUseCase();
    const logger = makeLogger();
    const now = vi.fn().mockReturnValue(FIXED_NOW);

    const runner = new PrometheusIngestRunner({ config: makeConfig(), promClient: client, processIncidentUseCase: useCase, logger }, { now });
    runner.start();
    await flushMicrotasks();

    // correlationId should embed FIXED_NOW not a real timestamp
    const correlationId = useCase.execute.mock.calls[0]![1] as string;
    expect(correlationId).toBe(`prometheus-0-${FIXED_NOW}`);
    await runner.stop();
  });
});
