import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProcessIncidentUseCase } from '../process-incident.use-case.js';
import type { NormalizedAlert } from '../../../domain/entities/alert.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';
import type {
  IDeduplicationStore,
  ITraceRepository,
  ILLMProvider,
  INotifier,
  IRuleEngine,
  LLMResult,
  NotifyResult,
  RuleActionResult,
} from '../../../domain/ports/index.js';
import { NotifyOutcome } from '../../../domain/ports/index.js';
import type { Logger } from '../../../shared/logger/index.js';
import { Component, Outcome } from '../../../shared/logger/index.js';
import { AlertType } from '../../../shared/constants.js';
import { RuleActionType } from '../../../domain/entities/rule.js';
import type { RuleAction } from '../../../domain/entities/rule.js';
import * as metricsModule from '../../../shared/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test factories
// ─────────────────────────────────────────────────────────────────────────────

function makeAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    alertName: 'HighErrorRate',
    serviceName: 'test-service',
    alertType: AlertType.Error,
    endpointPath: '/api',
    status: 'firing',
    startsAt: new Date().toISOString(),
    labels: {},
    annotations: {},
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<LLMAnalysis> = {}): LLMAnalysis {
  return {
    probable_cause: 'DB pool exhaustion',
    impacted_services: ['payments-api'],
    recommended_steps: ['Scale DB'],
    urgency_level: 'high',
    requires_rollback: false,
    ...overrides,
  };
}

function makeLLMResult(overrides: Partial<LLMResult> = {}): LLMResult {
  return {
    analysis: makeAnalysis(),
    provider: 'mock',
    model: 'mock-model',
    latencyMs: 12,
    promptTokens: 20,
    completionTokens: 10,
    ...overrides,
  };
}

function makeLoggerMock(): Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;
}

const DEFAULT_DEDUP_RESULT = { isNew: true, ttlSeconds: 300 };

interface DepsOverrides {
  dedup?: IDeduplicationStore;
  traces?: ITraceRepository;
  llm?: ILLMProvider;
  notifier?: INotifier;
  ruleEngine?: IRuleEngine;
  onClustersBuilt?: (count: number) => void;
}

function makeDeps(overrides: DepsOverrides = {}) {
  const logger = makeLoggerMock();
  return {
    dedup: overrides.dedup ?? {
      isNew: vi.fn().mockResolvedValue({ ...DEFAULT_DEDUP_RESULT }),
      reset: vi.fn(),
    },
    traces: overrides.traces ?? { findByTraceId: vi.fn().mockResolvedValue([]) },
    llm: overrides.llm ?? { analyze: vi.fn().mockResolvedValue(makeLLMResult()) },
    notifier: overrides.notifier ?? {
      send: vi.fn().mockImplementation(
        async (_cluster: unknown, _analysis: unknown, channel?: string): Promise<NotifyResult> => ({
          outcome: NotifyOutcome.Success,
          latencyMs: 5,
          channels: [channel ?? 'default'],
        }),
      ),
    },
    logger,
    dedupTtlSeconds: 300,
    ...(overrides.ruleEngine !== undefined && { ruleEngine: overrides.ruleEngine }),
    ...(overrides.onClustersBuilt !== undefined && { onClustersBuilt: overrides.onClustersBuilt }),
  };
}

/** Extracts the wide events emitted via single-argument logger.info(event) calls. */
function emittedEvents(logger: Logger): Array<Record<string, unknown>> {
  return vi.mocked(logger.info).mock.calls.map((call) => call[0] as Record<string, unknown>);
}

const emptyResult: RuleActionResult = { suppressed: false, actions: [], tags: {} };

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline behavior (approval tests — port interactions preserved)
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — pipeline behavior', () => {
  it('processes a new incident through all stages', async () => {
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);
    const alert = makeAlert({ alertName: 'Alert1', traceId: 't1' });

    vi.mocked(deps.traces.findByTraceId).mockResolvedValue([{ span: 'test' }]);

    await useCase.execute([alert], 'corr-1');

    expect(deps.dedup.isNew).toHaveBeenCalled();
    expect(deps.traces.findByTraceId).toHaveBeenCalledWith('t1');
    expect(deps.llm.analyze).toHaveBeenCalled();
    expect(deps.notifier.send).toHaveBeenCalled();
  });

  it('skips duplicate incidents before any downstream stage', async () => {
    const deps = makeDeps({
      dedup: {
        isNew: vi.fn().mockResolvedValue({ isNew: false, ttlSeconds: 300 }),
        reset: vi.fn(),
      },
    });
    const useCase = new ProcessIncidentUseCase(deps);
    const alert = makeAlert({ alertName: 'Alert2', traceId: 't2', serviceName: 'service-2' });

    await useCase.execute([alert], 'corr-2');

    expect(deps.dedup.isNew).toHaveBeenCalled();
    expect(deps.traces.findByTraceId).not.toHaveBeenCalled();
    expect(deps.llm.analyze).not.toHaveBeenCalled();
    expect(deps.notifier.send).not.toHaveBeenCalled();
  });

  it('notifies with null analysis even if LLM fails', async () => {
    const deps = makeDeps({
      llm: { analyze: vi.fn().mockRejectedValue(new Error('LLM Down')) },
    });
    const useCase = new ProcessIncidentUseCase(deps);
    const alert = makeAlert({ alertName: 'Alert3', traceId: 't3', serviceName: 'service-3' });

    await useCase.execute([alert], 'corr-3');

    expect(deps.llm.analyze).toHaveBeenCalled();
    expect(deps.notifier.send).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onClustersBuilt callback
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — onClustersBuilt callback', () => {
  it('calls onClustersBuilt with cluster count for a non-empty batch', async () => {
    const onClustersBuilt = vi.fn();
    const deps = makeDeps({
      dedup: {
        isNew: vi.fn().mockResolvedValue({ isNew: false, ttlSeconds: 300 }),
        reset: vi.fn(),
      },
      onClustersBuilt,
    });
    const useCase = new ProcessIncidentUseCase(deps);

    const alerts = [
      makeAlert({ serviceName: 'svc-a', alertType: AlertType.Error, endpointPath: '/a' }),
      makeAlert({ serviceName: 'svc-b', alertType: AlertType.Error, endpointPath: '/b' }),
    ];

    await useCase.execute(alerts, 'corr-cb');

    expect(onClustersBuilt).toHaveBeenCalledTimes(1);
    const [count] = vi.mocked(onClustersBuilt).mock.calls[0] as [number];
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('calls onClustersBuilt with 0 for an empty batch', async () => {
    const onClustersBuilt = vi.fn();
    const deps = makeDeps({ onClustersBuilt });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([], 'corr-empty');

    expect(onClustersBuilt).toHaveBeenCalledOnce();
    expect(onClustersBuilt).toHaveBeenCalledWith(0);
  });

  it('does not throw when onClustersBuilt is not provided', async () => {
    const deps = makeDeps({
      dedup: {
        isNew: vi.fn().mockResolvedValue({ isNew: false, ttlSeconds: 300 }),
        reset: vi.fn(),
      },
    });
    const useCase = new ProcessIncidentUseCase(deps);

    await expect(useCase.execute([makeAlert()], 'corr-no-cb')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dedup counter emission
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — dedup counter emission', () => {
  it('increments dedupNew when cluster is new', async () => {
    const dedupNewSpy = vi.spyOn(metricsModule.dedupNew, 'inc');
    const dedupDuplicateSpy = vi.spyOn(metricsModule.dedupDuplicate, 'inc');
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-dedup-new' })], 'corr-new');

    expect(dedupNewSpy).toHaveBeenCalledOnce();
    expect(dedupNewSpy).toHaveBeenCalledWith(expect.objectContaining({ source: expect.any(String) }));
    expect(dedupDuplicateSpy).not.toHaveBeenCalled();
  });

  it('increments dedupDuplicate when cluster is duplicate', async () => {
    const dedupNewSpy = vi.spyOn(metricsModule.dedupNew, 'inc');
    const dedupDuplicateSpy = vi.spyOn(metricsModule.dedupDuplicate, 'inc');
    const deps = makeDeps({
      dedup: {
        isNew: vi.fn().mockResolvedValue({ isNew: false, ttlSeconds: 300 }),
        reset: vi.fn(),
      },
    });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-dedup-dup' })], 'corr-dup');

    expect(dedupDuplicateSpy).toHaveBeenCalledOnce();
    expect(dedupDuplicateSpy).toHaveBeenCalledWith(expect.objectContaining({ source: expect.any(String) }));
    expect(dedupNewSpy).not.toHaveBeenCalled();
  });

  it('never increments both counters in the same cluster', async () => {
    const dedupNewSpy = vi.spyOn(metricsModule.dedupNew, 'inc');
    const dedupDuplicateSpy = vi.spyOn(metricsModule.dedupDuplicate, 'inc');
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-dedup-both' })], 'corr-both');

    const newCalls = dedupNewSpy.mock.calls.length;
    const dupCalls = dedupDuplicateSpy.mock.calls.length;
    // Exactly one fires, never both
    expect(newCalls + dupCalls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule Engine Integration — PRE-LLM hooks
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — IRuleEngine PRE-LLM hooks', () => {
  it('works without rule engine (backward compatible)', async () => {
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-no-re' })], 'corr-no-re');

    expect(deps.llm.analyze).toHaveBeenCalledOnce();
    expect(deps.notifier.send).toHaveBeenCalledOnce();
  });

  it('works with rule engine that returns pass-through (no match)', async () => {
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(emptyResult),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-pass' })], 'corr-pass');

    expect(mockRuleEngine.evaluatePreLlm).toHaveBeenCalledOnce();
    expect(deps.llm.analyze).toHaveBeenCalledOnce(); // LLM still proceeds
    expect(deps.notifier.send).toHaveBeenCalledOnce(); // notification still sends
  });

  it('suppresses cluster — skips LLM, traces, and notification', async () => {
    const suppressResult: RuleActionResult = {
      suppressed: true,
      actions: [],
      matchedRuleId: 'suppress-staging',
      tags: {},
    };
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(suppressResult),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };
    const suppressedSpy = vi.spyOn(metricsModule.suppressedClusters, 'inc');
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-suppress' })], 'corr-suppress');

    // Rule engine was called
    expect(mockRuleEngine.evaluatePreLlm).toHaveBeenCalledOnce();
    // LLM NOT called (suppressed)
    expect(deps.llm.analyze).not.toHaveBeenCalled();
    // Traces NOT fetched (suppressed)
    expect(deps.traces.findByTraceId).not.toHaveBeenCalled();
    // Notifier NOT called (suppressed)
    expect(deps.notifier.send).not.toHaveBeenCalled();
    // POST-LLM NOT called (suppressed cluster never reaches it)
    expect(mockRuleEngine.evaluatePostLlm).not.toHaveBeenCalled();
    // Metric incremented
    expect(suppressedSpy).toHaveBeenCalledWith({ rule_id: 'suppress-staging' });
  });

  it('suppressed clusters do not prevent other clusters from processing', async () => {
    const suppressResult: RuleActionResult = {
      suppressed: true,
      actions: [],
      matchedRuleId: 'suppress-rule',
      tags: {},
    };

    let callCount = 0;
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockImplementation(() => {
        callCount++;
        // First cluster gets suppressed, second passes through
        if (callCount === 1) return suppressResult;
        return emptyResult;
      }),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    const alerts = [
      makeAlert({ serviceName: 'svc-a', alertType: AlertType.Error, endpointPath: '/a' }),
      makeAlert({ serviceName: 'svc-b', alertType: AlertType.Error, endpointPath: '/b' }),
    ];

    await useCase.execute(alerts, 'corr-mixed');

    // First cluster suppressed → LLM not called for it
    // Second cluster processed → LLM called once total
    expect(deps.llm.analyze).toHaveBeenCalledOnce();
    expect(deps.notifier.send).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule Engine Integration — POST-LLM hooks
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — IRuleEngine POST-LLM hooks', () => {
  it('calls evaluatePostLlm with correct cluster and analysis', async () => {
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(emptyResult),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-post' })], 'corr-post');

    expect(mockRuleEngine.evaluatePostLlm).toHaveBeenCalledOnce();
    const [clusterArg, analysisArg] = vi.mocked(mockRuleEngine.evaluatePostLlm).mock.calls[0];
    expect(clusterArg.serviceName).toBe('svc-post');
    expect(analysisArg.urgency_level).toBe('high');
  });

  it('does NOT call evaluatePostLlm when LLM fails', async () => {
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(emptyResult),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };
    const deps = makeDeps({
      llm: { analyze: vi.fn().mockRejectedValue(new Error('LLM Down')) },
      ruleEngine: mockRuleEngine,
    });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-fail' })], 'corr-fail');

    // POST-LLM NOT called when analysis is null (LLM failed)
    expect(mockRuleEngine.evaluatePostLlm).not.toHaveBeenCalled();
    // Notification still fires (with null analysis)
    expect(deps.notifier.send).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule Engine Integration — Notification routing with actions
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — Rule action routing', () => {
  function makeResult(overrides: Partial<RuleActionResult> = {}): RuleActionResult {
    return {
      suppressed: false,
      actions: [],
      tags: {},
      ...overrides,
    };
  }

  it('PRE-LLM Route action — notification is sent to the correct channel', async () => {
    const routeActions: RuleAction[] = [
      { type: RuleActionType.Route, channel: 'slack-sre' },
    ];
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(makeResult({ actions: routeActions })),
      evaluatePostLlm: vi.fn().mockReturnValue(makeResult()),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-route' })], 'corr-route');

    // LLM still proceeds (Route does NOT suppress)
    expect(deps.llm.analyze).toHaveBeenCalledOnce();
    // Notification sent with channel override
    expect(deps.notifier.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'slack-sre',
    );
  });

  it('PRE-LLM Escalate action — default notifier still fires', async () => {
    const escalateActions: RuleAction[] = [
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(makeResult({ actions: escalateActions })),
      evaluatePostLlm: vi.fn().mockReturnValue(makeResult()),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-esc' })], 'corr-esc');

    // Default notification fires
    expect(deps.notifier.send).toHaveBeenCalled();
    // Escalate action adds channel parameter
    const calls = vi.mocked(deps.notifier.send).mock.calls;
    // At least one call with escalation channel
    const escalateCall = calls.find((c) => c[2] === 'pagerduty-critical');
    expect(escalateCall).toBeDefined();
  });

  it('POST-LLM Escalate action — additional notification after LLM', async () => {
    const postEscalateActions: RuleAction[] = [
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(makeResult()),
      evaluatePostLlm: vi.fn().mockReturnValue(makeResult({ actions: postEscalateActions })),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-post-esc' })], 'corr-post-esc');

    expect(mockRuleEngine.evaluatePostLlm).toHaveBeenCalledOnce();
    // Escalate action produces channel param in notification
    const calls = vi.mocked(deps.notifier.send).mock.calls;
    const escalateCall = calls.find((c) => c[2] === 'pagerduty-critical');
    expect(escalateCall).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wide events — one canonical log line per cluster
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — wide events', () => {
  it('emits exactly one wide event per cluster with every section populated on success', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always sample
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);
    vi.mocked(deps.traces.findByTraceId).mockResolvedValue([{ span: 's1' }, { span: 's2' }]);

    await useCase.execute([makeAlert({ serviceName: 'svc-wide', traceId: 't-1' })], 'corr-wide');

    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [event] = emittedEvents(deps.logger);
    expect(event).toMatchObject({
      component: Component.UseCase,
      outcome: Outcome.Success,
      correlationId: 'corr-wide',
      cluster: { serviceName: 'svc-wide', alertCount: 1, spanCount: 2 },
      dedup: { isNew: true, ttlSeconds: 300 },
      llm: { provider: 'mock', model: 'mock-model', latencyMs: 12, urgency: 'high', tokens: 30 },
      notify: { channels: ['default'], outcome: NotifyOutcome.Success },
    });
    // notify.latencyMs is the wall-clock stage time measured by the use case
    expect((event['notify'] as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);
    const cluster = event['cluster'] as { fingerprint: string };
    expect(cluster.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(event['requestId']).toBe(`corr-wide:${cluster.fingerprint}`);
    expect(event['durationMs']).toBeGreaterThanOrEqual(0);
    expect(typeof event['timestamp']).toBe('string');
  });

  it('emits one event per cluster for a multi-cluster batch — no scattered child logs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);

    const alerts = [
      makeAlert({ serviceName: 'svc-a', endpointPath: '/a' }),
      makeAlert({ serviceName: 'svc-b', endpointPath: '/b' }),
    ];

    await useCase.execute(alerts, 'corr-multi');

    // 2 clusters → exactly 2 log lines (previously 4-6 per cluster)
    expect(deps.logger.info).toHaveBeenCalledTimes(2);
    expect(deps.logger.child).not.toHaveBeenCalled();
    expect(deps.logger.debug).not.toHaveBeenCalled();
    expect(deps.logger.warn).not.toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();

    const services = emittedEvents(deps.logger).map(
      (e) => (e['cluster'] as { serviceName: string }).serviceName,
    );
    expect(services).toEqual(['svc-a', 'svc-b']);
  });

  it('emits no wide event for duplicate clusters — only the dedup metric fires', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deps = makeDeps({
      dedup: {
        isNew: vi.fn().mockResolvedValue({ isNew: false, ttlSeconds: 300 }),
        reset: vi.fn(),
      },
    });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-dup' })], 'corr-dup-event');

    expect(deps.logger.info).not.toHaveBeenCalled();
    expect(deps.logger.debug).not.toHaveBeenCalled();
    expect(deps.logger.warn).not.toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it('emits outcome=suppressed with the rule section when a PRE-LLM rule suppresses', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue({
        suppressed: true,
        actions: [],
        matchedRuleId: 'suppress-staging',
        tags: {},
      }),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'staging' })], 'corr-supp');

    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [event] = emittedEvents(deps.logger);
    expect(event).toMatchObject({
      outcome: Outcome.Suppressed,
      rule: { matched: true, suppressed: true, matchedRuleId: 'suppress-staging' },
      dedup: { isNew: true, ttlSeconds: 300 },
    });
    // Suppressed clusters never reach LLM/notify — sections stay absent
    expect(event['llm']).toBeUndefined();
    expect(event['notify']).toBeUndefined();
  });

  it('emits outcome=degraded with the LLM error captured when inference fails', async () => {
    // 0.99 would skip a normal event — errors must still be emitted (tail sampling)
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const deps = makeDeps({
      llm: { analyze: vi.fn().mockRejectedValue(new Error('LLM Down')) },
    });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-degraded' })], 'corr-degraded');

    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [event] = emittedEvents(deps.logger);
    expect(event).toMatchObject({
      outcome: Outcome.Degraded,
      error: { message: 'LLM Down', name: 'Error' },
      notify: { outcome: NotifyOutcome.Success },
    });
    expect(event['llm']).toBeUndefined();
  });

  it('emits outcome=error with notify failure recorded, then rethrows for the queue retry', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const deps = makeDeps({
      notifier: { send: vi.fn().mockRejectedValue(new Error('Slack 500')) },
    });
    const useCase = new ProcessIncidentUseCase(deps);

    await expect(
      useCase.execute([makeAlert({ serviceName: 'svc-notify-fail' })], 'corr-notify-fail'),
    ).rejects.toThrow('Slack 500');

    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [event] = emittedEvents(deps.logger);
    expect(event).toMatchObject({
      outcome: Outcome.Error,
      notify: { outcome: NotifyOutcome.Failure },
      error: { message: 'Slack 500', name: 'Error' },
    });
  });

  it('aggregates route and escalate channels into the notify section', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue({
        suppressed: false,
        actions: [
          { type: RuleActionType.Route, channel: 'slack-sre' },
          { type: RuleActionType.Escalate, channel: 'slack-oncall' },
        ],
        tags: {},
      }),
      evaluatePostLlm: vi.fn().mockReturnValue({
        suppressed: false,
        actions: [{ type: RuleActionType.Escalate, channel: 'pagerduty-critical' }],
        tags: {},
      }),
    };
    const deps = makeDeps({ ruleEngine: mockRuleEngine });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-channels' })], 'corr-channels');

    const [event] = emittedEvents(deps.logger);
    expect(event['notify']).toMatchObject({
      channels: ['slack-sre', 'slack-oncall', 'pagerduty-critical'],
      outcome: NotifyOutcome.Success,
    });
  });

  it('records the dedup fail-open error in the event when the store is unreachable', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deps = makeDeps({
      dedup: {
        isNew: vi.fn().mockResolvedValue({
          isNew: true,
          ttlSeconds: 300,
          error: 'Redis connection failed',
        }),
        reset: vi.fn(),
      },
    });
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-dedup-err' })], 'corr-dedup-err');

    const [event] = emittedEvents(deps.logger);
    expect(event['dedup']).toMatchObject({
      isNew: true,
      ttlSeconds: 300,
      error: 'Redis connection failed',
    });
    // Fail-open still processes the cluster normally
    expect(event['outcome']).toBe(Outcome.Success);
  });

  it('counts trace fetch failures in the cluster section instead of per-trace warn logs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deps = makeDeps();
    // Two trace IDs: first by startsAt + slowest by latency
    vi.mocked(deps.traces.findByTraceId)
      .mockRejectedValueOnce(new Error('loki down'))
      .mockResolvedValueOnce([{ span: 'ok' }]);
    const useCase = new ProcessIncidentUseCase(deps);

    const alerts = [
      makeAlert({
        serviceName: 'svc-t',
        endpointPath: '/t',
        traceId: 't-first',
        startsAt: '2026-06-09T12:00:00.000Z',
        latencyMs: 100,
      }),
      makeAlert({
        serviceName: 'svc-t',
        endpointPath: '/t',
        traceId: 't-slow',
        startsAt: '2026-06-09T12:00:01.000Z',
        latencyMs: 500,
      }),
    ];

    await useCase.execute(alerts, 'corr-trace-err');

    const [event] = emittedEvents(deps.logger);
    expect(event['cluster']).toMatchObject({ alertCount: 2, spanCount: 1, traceErrors: 1 });
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wide events — tail sampling and redaction integration
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — wide event sampling and redaction', () => {
  it('skips emission for a normal event when the sample roll fails', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // above the 5% normal rate
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-skipped' })], 'corr-skipped');

    expect(deps.logger.info).not.toHaveBeenCalled();
  });

  it('emits a normal event when the sample roll succeeds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // below the 5% normal rate
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-sampled' })], 'corr-sampled');

    expect(deps.logger.info).toHaveBeenCalledTimes(1);
    const [event] = emittedEvents(deps.logger);
    expect(event['outcome']).toBe(Outcome.Success);
  });

  it('passes the event through PII redaction — whitelisted fields survive intact', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deps = makeDeps();
    const useCase = new ProcessIncidentUseCase(deps);

    await useCase.execute([makeAlert({ serviceName: 'svc-redact' })], 'corr-redact');

    const [event] = emittedEvents(deps.logger);
    // These would be '[REDACTED]' if the whitelist dropped them
    expect(event['component']).toBe(Component.UseCase);
    expect(event['outcome']).toBe(Outcome.Success);
    expect(event['correlationId']).toBe('corr-redact');
  });
});
