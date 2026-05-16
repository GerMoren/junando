import { describe, it, expect, vi, afterEach } from 'vitest';
import { IngestRunner } from '../ingest-runner.js';
import { AlertType } from '@junando/core';
import type { ILokiHttpClient, LokiQueryResponse } from '../../ports/loki-http-client.port.js';
import type { IngestConfig } from '../../config/ingest-config.schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOKI_SUCCESS: LokiQueryResponse = {
  status: 'success',
  data: {
    resultType: 'streams',
    result: [
      {
        stream: { service: 'api', level: 'error' },
        values: [['1700000030000000000', 'ERROR something broke']],
      },
    ],
  },
};

const LOKI_EMPTY: LokiQueryResponse = {
  status: 'success',
  data: { resultType: 'streams', result: [] },
};

function makeConfig(intervalMs = 60_000): IngestConfig {
  return {
    ingest: {
      intervalMs,
      loki: { url: 'http://loki:3100', timeoutMs: 10_000 },
      rules: [
        {
          name: 'rule-one',
          query: '{service="api"} |= "ERROR"',
          service: 'api',
          alertType: AlertType.Error,
          severity: 'critical',
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

/** Flush all pending microtasks (promises) without advancing fake timers. */
async function flushMicrotasks() {
  // Multiple rounds to handle chained promises
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('LKI-04-A: first poll fires immediately before first interval', async () => {
    const lokiClient: ILokiHttpClient = {
      queryRange: vi.fn().mockResolvedValue(LOKI_SUCCESS),
    };
    const useCase = { execute: vi.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();

    const runner = new IngestRunner({
      config: makeConfig(60_000),
      lokiClient,
      processIncidentUseCase: useCase,
      logger,
    });

    runner.start();
    await flushMicrotasks();

    expect(lokiClient.queryRange).toHaveBeenCalledTimes(1);
    await runner.stop();
  });

  it('LKI-01-A: matches returned → useCase.execute called once per tick', async () => {
    const lokiClient: ILokiHttpClient = {
      queryRange: vi.fn().mockResolvedValue(LOKI_SUCCESS),
    };
    const useCase = { execute: vi.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();

    const runner = new IngestRunner({
      config: makeConfig(60_000),
      lokiClient,
      processIncidentUseCase: useCase,
      logger,
    });

    runner.start();
    await flushMicrotasks();

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    await runner.stop();
  });

  it('LKI-01-B: empty result → useCase.execute NOT called', async () => {
    const lokiClient: ILokiHttpClient = {
      queryRange: vi.fn().mockResolvedValue(LOKI_EMPTY),
    };
    const useCase = { execute: vi.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();

    const runner = new IngestRunner({
      config: makeConfig(60_000),
      lokiClient,
      processIncidentUseCase: useCase,
      logger,
    });

    runner.start();
    await flushMicrotasks();

    expect(useCase.execute).not.toHaveBeenCalled();
    await runner.stop();
  });

  it('LKI-02: one rule failure does not stop others (Promise.allSettled isolation)', async () => {
    const twoRuleConfig: IngestConfig = {
      ingest: {
        intervalMs: 60_000,
        loki: { url: 'http://loki:3100', timeoutMs: 10_000 },
        rules: [
          {
            name: 'failing-rule',
            query: '{job="a"}',
            service: 'api',
            alertType: AlertType.Error,
            severity: 'critical',
          },
          {
            name: 'passing-rule',
            query: '{job="b"}',
            service: 'worker',
            alertType: AlertType.Error,
            severity: 'critical',
          },
        ],
      },
    };

    const lokiClient: ILokiHttpClient = {
      queryRange: vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(LOKI_EMPTY),
    };
    const useCase = { execute: vi.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();

    const runner = new IngestRunner({
      config: twoRuleConfig,
      lokiClient,
      processIncidentUseCase: useCase,
      logger,
    });

    runner.start();
    await flushMicrotasks();

    // The error should be logged but the second rule still processed
    expect(logger.error).toHaveBeenCalledOnce();
    // lokiClient called twice — once per rule
    expect(lokiClient.queryRange).toHaveBeenCalledTimes(2);
    await runner.stop();
  });

  it('LKI-05-A: stop() drains in-flight promises before resolving', async () => {
    let resolveQuery!: (v: LokiQueryResponse) => void;
    const slowQuery = new Promise<LokiQueryResponse>((resolve) => {
      resolveQuery = resolve;
    });

    const lokiClient: ILokiHttpClient = {
      queryRange: vi.fn().mockReturnValue(slowQuery),
    };
    const useCase = { execute: vi.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();

    const runner = new IngestRunner({
      config: makeConfig(60_000),
      lokiClient,
      processIncidentUseCase: useCase,
      logger,
    });

    runner.start();
    // tick is running (query in progress)
    await flushMicrotasks();

    const stopPromise = runner.stop();
    let stopResolved = false;
    void stopPromise.then(() => {
      stopResolved = true;
    });

    // stop() should NOT resolve yet while query is in-flight
    await flushMicrotasks();
    expect(stopResolved).toBe(false);

    // resolve the slow query
    resolveQuery(LOKI_EMPTY);
    await stopPromise;
    expect(stopResolved).toBe(true);
  });
});
