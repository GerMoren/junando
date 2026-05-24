/**
 * End-to-end scenarios — exercise the full ProcessIncidentUseCase pipeline
 * (clustering -> dedup -> traces -> LLM -> notifier) with in-memory stubs.
 *
 * No docker, no network, no credentials. These tests prove that the wiring
 * between components stays correct as we refactor. Unit tests cover each
 * component in isolation; these cover the integration.
 *
 * Each scenario:
 *   1. Builds a realistic Alertmanager payload (the same shape the webhook
 *      handler receives in production).
 *   2. Runs it through `normalizePayload` and then through the use case.
 *   3. Asserts on what reached the MockNotifier and the dedup store.
 *
 * To add a new scenario: add a fixture under ./fixtures/, then write a new
 * `it(...)` block that loads it and asserts the expected outcome.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessIncidentUseCase } from '../../application/use-cases/process-incident.use-case.js';
import { normalizePayload } from '../../application/dtos/normalize-payload.js';
import { InMemoryDeduplicationStore } from '../../infrastructure/dedup/redis-dedup.adapter.js';
import { MockLLMProvider } from '../../infrastructure/llm/llm.adapter.js';
import { MockNotifier } from './helpers/mock-notifier.js';
import { silentLogger } from './helpers/silent-logger.js';
import { latencySpikePayload } from './fixtures/latency-spike.fixture.js';
import { dbOutagePayload } from './fixtures/db-outage.fixture.js';
import type { ITraceRepository } from '../../domain/ports/index.js';

const noopTraces: ITraceRepository = {
  findByTraceId: async () => [],
};

interface Harness {
  useCase: ProcessIncidentUseCase;
  notifier: MockNotifier;
  dedup: InMemoryDeduplicationStore;
  llm: MockLLMProvider;
}

function buildHarness(): Harness {
  const dedup = new InMemoryDeduplicationStore();
  const llm = new MockLLMProvider();
  const notifier = new MockNotifier();
  const useCase = new ProcessIncidentUseCase({
    dedup,
    traces: noopTraces,
    llm,
    notifier,
    logger: silentLogger,
    dedupTtlSeconds: 300,
  });
  return { useCase, notifier, dedup, llm };
}

describe('E2E: canonical incident scenarios', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  describe('latency_spike', () => {
    it('produces exactly one notification with the LLM analysis attached', async () => {
      const alerts = normalizePayload(latencySpikePayload);
      expect(alerts.length).toBeGreaterThan(0);

      await harness.useCase.execute(alerts, 'corr-latency-spike-1');

      expect(harness.notifier.calls).toHaveLength(1);
      const call = harness.notifier.calls[0]!;
      expect(call.cluster.serviceName).toBe('checkout-api');
      expect(call.cluster.alertCount).toBe(alerts.length);
      expect(call.analysis).not.toBeNull();
      expect(call.analysis?.impacted_services).toContain('checkout-api');
    });

    it('deduplicates a repeated payload within the TTL', async () => {
      const alerts = normalizePayload(latencySpikePayload);

      await harness.useCase.execute(alerts, 'corr-latency-spike-2a');
      await harness.useCase.execute(alerts, 'corr-latency-spike-2b');

      // First run notifies; second run hits the dedup store and skips.
      expect(harness.notifier.calls).toHaveLength(1);
    });
  });

  describe('db_outage', () => {
    it('produces one notification per distinct service even within a single batch', async () => {
      const alerts = normalizePayload(dbOutagePayload);
      expect(alerts.length).toBeGreaterThan(1);

      await harness.useCase.execute(alerts, 'corr-db-outage-1');

      const services = new Set(harness.notifier.calls.map((c) => c.cluster.serviceName));
      expect(services.size).toBeGreaterThanOrEqual(2);
      expect(services).toContain('orders-api');
      expect(services).toContain('payments-worker');

      // Every notification must carry an LLM analysis (no silent drops).
      for (const call of harness.notifier.calls) {
        expect(call.analysis).not.toBeNull();
        expect(call.analysis?.probable_cause).toMatch(/orders-api|payments-worker/);
      }
    });

    it('calls the LLM exactly once per cluster (no redundant inference)', async () => {
      const alerts = normalizePayload(dbOutagePayload);

      await harness.useCase.execute(alerts, 'corr-db-outage-2');

      expect(harness.llm.callLog.length).toBe(harness.notifier.calls.length);
    });
  });

  describe('cross-scenario', () => {
    it('processes back-to-back scenarios without state leakage', async () => {
      await harness.useCase.execute(
        normalizePayload(latencySpikePayload),
        'corr-mixed-a',
      );
      await harness.useCase.execute(
        normalizePayload(dbOutagePayload),
        'corr-mixed-b',
      );

      const services = harness.notifier.calls.map((c) => c.cluster.serviceName);
      expect(services).toContain('checkout-api');
      expect(services).toContain('orders-api');
      expect(services).toContain('payments-worker');
    });
  });
});
