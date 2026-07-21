import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessIncidentUseCase } from '../process-incident.use-case.js';
import type { NormalizedAlert } from '../../../domain/entities/alert.js';
import type {
  IDeduplicationStore,
  ITraceRepository,
  ILLMProvider,
  INotifier,
  IRuleEngine,
  RuleActionResult,
} from '../../../domain/ports/index.js';
import type { Logger } from '../../../shared/logger/index.js';
import { AlertType } from '../../../shared/constants.js';
import { RuleActionType } from '../../../domain/entities/rule.js';
import type { RuleAction } from '../../../domain/entities/rule.js';
import * as metricsModule from '../../../shared/metrics/index.js';

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

describe('ProcessIncidentUseCase', () => {
  const mockDedup: IDeduplicationStore = {
    isNew: vi.fn(),
    reset: vi.fn(),
  };
  const mockTraces: ITraceRepository = {
    findByTraceId: vi.fn(),
  };
  const mockLlm: ILLMProvider = {
    analyze: vi.fn(),
  };
  const mockNotifier: INotifier = {
    send: vi.fn(),
  };
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;

  const useCase = new ProcessIncidentUseCase({
    dedup: mockDedup,
    traces: mockTraces,
    llm: mockLlm,
    notifier: mockNotifier,
    logger: mockLogger,
    dedupTtlSeconds: 300,
  });

  it('processes a new incident correctly', async () => {
    const alert = makeAlert({ alertName: 'Alert1', traceId: 't1' });

    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: true, ttlSeconds: 300 });
    vi.mocked(mockTraces.findByTraceId).mockResolvedValue([{ span: 'test' }]);
    vi.mocked(mockLlm.analyze).mockResolvedValue({
      probable_cause: 'test',
      impacted_services: ['test'],
      recommended_steps: [],
      urgency_level: 'high',
      requires_rollback: false,
    });

    await useCase.execute([alert], 'corr-1');

    expect(mockDedup.isNew).toHaveBeenCalled();
    expect(mockTraces.findByTraceId).toHaveBeenCalledWith('t1');
    expect(mockLlm.analyze).toHaveBeenCalled();
    expect(mockNotifier.send).toHaveBeenCalled();
  });

  it('skips duplicate incidents', async () => {
    const alert = makeAlert({ alertName: 'Alert2', traceId: 't2', serviceName: 'service-2' });

    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: false, ttlSeconds: 300 });
    vi.mocked(mockTraces.findByTraceId).mockClear();
    vi.mocked(mockLlm.analyze).mockClear();
    vi.mocked(mockNotifier.send).mockClear();

    await useCase.execute([alert], 'corr-2');

    expect(mockDedup.isNew).toHaveBeenCalled();
    expect(mockTraces.findByTraceId).not.toHaveBeenCalled();
    expect(mockLlm.analyze).not.toHaveBeenCalled();
    expect(mockNotifier.send).not.toHaveBeenCalled();
  });

  it('notifies even if LLM fails', async () => {
    const alert = makeAlert({ alertName: 'Alert3', traceId: 't3', serviceName: 'service-3' });

    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: true, ttlSeconds: 300 });
    vi.mocked(mockTraces.findByTraceId).mockResolvedValue([]);
    vi.mocked(mockLlm.analyze).mockRejectedValue(new Error('LLM Down'));
    vi.mocked(mockNotifier.send).mockClear();

    await useCase.execute([alert], 'corr-3');

    expect(mockLlm.analyze).toHaveBeenCalled();
    expect(mockNotifier.send).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });
});

describe('ProcessIncidentUseCase — onClustersBuilt callback', () => {
  const mockDedup: IDeduplicationStore = { isNew: vi.fn(), reset: vi.fn() };
  const mockTraces: ITraceRepository = { findByTraceId: vi.fn() };
  const mockLlm: ILLMProvider = { analyze: vi.fn() };
  const mockNotifier: INotifier = { send: vi.fn() };
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;

  it('calls onClustersBuilt with cluster count for a non-empty batch', async () => {
    const onClustersBuilt = vi.fn();
    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup,
      traces: mockTraces,
      llm: mockLlm,
      notifier: mockNotifier,
      logger: mockLogger,
      dedupTtlSeconds: 300,
      onClustersBuilt,
    });

    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: false, ttlSeconds: 300 }); // skip inner processing
    vi.mocked(mockLlm.analyze).mockResolvedValue({
      probable_cause: 'x',
      impacted_services: ['s'],
      recommended_steps: [],
      urgency_level: 'low',
      requires_rollback: false,
    });

    const alerts = [
      makeAlert({ serviceName: 'svc-a', alertType: AlertType.Error, endpointPath: '/a' }),
      makeAlert({ serviceName: 'svc-b', alertType: AlertType.Error, endpointPath: '/b' }),
    ];

    await uc.execute(alerts, 'corr-cb');

    expect(onClustersBuilt).toHaveBeenCalledTimes(1);
    const [count] = vi.mocked(onClustersBuilt).mock.calls[0] as [number];
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('calls onClustersBuilt with 0 for an empty batch', async () => {
    const onClustersBuilt = vi.fn();
    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup,
      traces: mockTraces,
      llm: mockLlm,
      notifier: mockNotifier,
      logger: mockLogger,
      dedupTtlSeconds: 300,
      onClustersBuilt,
    });

    await uc.execute([], 'corr-empty');

    expect(onClustersBuilt).toHaveBeenCalledOnce();
    expect(onClustersBuilt).toHaveBeenCalledWith(0);
  });

  it('does not throw when onClustersBuilt is not provided', async () => {
    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup,
      traces: mockTraces,
      llm: mockLlm,
      notifier: mockNotifier,
      logger: mockLogger,
      dedupTtlSeconds: 300,
    });

    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: false, ttlSeconds: 300 });

    await expect(uc.execute([makeAlert()], 'corr-no-cb')).resolves.toBeUndefined();
  });
});

describe('ProcessIncidentUseCase — dedup counter emission', () => {
  const mockDedup: IDeduplicationStore = { isNew: vi.fn(), reset: vi.fn() };
  const mockTraces: ITraceRepository = { findByTraceId: vi.fn() };
  const mockLlm: ILLMProvider = { analyze: vi.fn() };
  const mockNotifier: INotifier = { send: vi.fn() };
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;

  let dedupNewSpy: ReturnType<typeof vi.spyOn>;
  let dedupDuplicateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    dedupNewSpy = vi.spyOn(metricsModule.dedupNew, 'inc');
    dedupDuplicateSpy = vi.spyOn(metricsModule.dedupDuplicate, 'inc');
    vi.mocked(mockTraces.findByTraceId).mockResolvedValue([]);
    vi.mocked(mockLlm.analyze).mockResolvedValue({
      probable_cause: 'test',
      impacted_services: [],
      recommended_steps: [],
      urgency_level: 'low',
      requires_rollback: false,
    });
    vi.mocked(mockNotifier.send).mockResolvedValue(undefined);
  });

  it('increments dedupNew when cluster is new', async () => {
    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: true, ttlSeconds: 300 });
    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-dedup-new' })], 'corr-new');

    expect(dedupNewSpy).toHaveBeenCalledOnce();
    expect(dedupNewSpy).toHaveBeenCalledWith(expect.objectContaining({ source: expect.any(String) }));
    expect(dedupDuplicateSpy).not.toHaveBeenCalled();
  });

  it('increments dedupDuplicate when cluster is duplicate', async () => {
    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: false, ttlSeconds: 300 });
    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-dedup-dup' })], 'corr-dup');

    expect(dedupDuplicateSpy).toHaveBeenCalledOnce();
    expect(dedupDuplicateSpy).toHaveBeenCalledWith(expect.objectContaining({ source: expect.any(String) }));
    expect(dedupNewSpy).not.toHaveBeenCalled();
  });

  it('never increments both counters in the same cluster', async () => {
    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: true, ttlSeconds: 300 });
    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-dedup-both' })], 'corr-both');

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
  const mockDedup: IDeduplicationStore = { isNew: vi.fn(), reset: vi.fn() };
  const mockTraces: ITraceRepository = { findByTraceId: vi.fn() };
  const mockLlm: ILLMProvider = { analyze: vi.fn() };
  const mockNotifier: INotifier = { send: vi.fn() };
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;

  const emptyResult: RuleActionResult = {
    suppressed: false,
    actions: [],
    tags: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: true, ttlSeconds: 300 });
    vi.mocked(mockTraces.findByTraceId).mockResolvedValue([]);
    vi.mocked(mockLlm.analyze).mockResolvedValue({
      probable_cause: 'test',
      impacted_services: [],
      recommended_steps: [],
      urgency_level: 'low',
      requires_rollback: false,
    });
    vi.mocked(mockNotifier.send).mockResolvedValue(undefined);
  });

  it('works without rule engine (backward compatible)', async () => {
    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-no-re' })], 'corr-no-re');

    expect(mockLlm.analyze).toHaveBeenCalledOnce();
    expect(mockNotifier.send).toHaveBeenCalledOnce();
  });

  it('works with rule engine that returns pass-through (no match)', async () => {
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(emptyResult),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-pass' })], 'corr-pass');

    expect(mockRuleEngine.evaluatePreLlm).toHaveBeenCalledOnce();
    expect(mockLlm.analyze).toHaveBeenCalledOnce(); // LLM still proceeds
    expect(mockNotifier.send).toHaveBeenCalledOnce(); // notification still sends
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

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-suppress' })], 'corr-suppress');

    // Rule engine was called
    expect(mockRuleEngine.evaluatePreLlm).toHaveBeenCalledOnce();
    // LLM NOT called (suppressed)
    expect(mockLlm.analyze).not.toHaveBeenCalled();
    // Traces NOT fetched (suppressed)
    expect(mockTraces.findByTraceId).not.toHaveBeenCalled();
    // Notifier NOT called (suppressed)
    expect(mockNotifier.send).not.toHaveBeenCalled();
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

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    const alerts = [
      makeAlert({ serviceName: 'svc-a', alertType: AlertType.Error, endpointPath: '/a' }),
      makeAlert({ serviceName: 'svc-b', alertType: AlertType.Error, endpointPath: '/b' }),
    ];

    await uc.execute(alerts, 'corr-mixed');

    // First cluster suppressed → LLM not called for it
    // Second cluster processed → LLM called once total
    expect(mockLlm.analyze).toHaveBeenCalledOnce();
    expect(mockNotifier.send).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule Engine Integration — POST-LLM hooks
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — IRuleEngine POST-LLM hooks', () => {
  const mockDedup: IDeduplicationStore = { isNew: vi.fn(), reset: vi.fn() };
  const mockTraces: ITraceRepository = { findByTraceId: vi.fn() };
  const mockLlm: ILLMProvider = { analyze: vi.fn() };
  const mockNotifier: INotifier = { send: vi.fn() };
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;

  const emptyResult: RuleActionResult = {
    suppressed: false,
    actions: [],
    tags: {},
  };

  const analysis = {
    probable_cause: 'DB pool exhaustion',
    impacted_services: ['payments-api'],
    recommended_steps: ['Scale DB'],
    urgency_level: 'critical' as const,
    requires_rollback: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: true, ttlSeconds: 300 });
    vi.mocked(mockTraces.findByTraceId).mockResolvedValue([]);
    vi.mocked(mockLlm.analyze).mockResolvedValue(analysis);
    vi.mocked(mockNotifier.send).mockResolvedValue(undefined);
  });

  it('calls evaluatePostLlm with correct cluster and analysis', async () => {
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(emptyResult),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-post' })], 'corr-post');

    expect(mockRuleEngine.evaluatePostLlm).toHaveBeenCalledOnce();
    const [clusterArg, analysisArg] = vi.mocked(mockRuleEngine.evaluatePostLlm).mock.calls[0];
    expect(clusterArg.serviceName).toBe('svc-post');
    expect(analysisArg.urgency_level).toBe('critical');
  });

  it('does NOT call evaluatePostLlm when LLM fails', async () => {
    vi.mocked(mockLlm.analyze).mockRejectedValue(new Error('LLM Down'));

    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(emptyResult),
      evaluatePostLlm: vi.fn().mockReturnValue(emptyResult),
    };

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-fail' })], 'corr-fail');

    // POST-LLM NOT called when analysis is null (LLM failed)
    expect(mockRuleEngine.evaluatePostLlm).not.toHaveBeenCalled();
    // Notification still fires (with null analysis)
    expect(mockNotifier.send).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule Engine Integration — Notification routing with actions
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIncidentUseCase — Rule action routing', () => {
  const mockDedup: IDeduplicationStore = { isNew: vi.fn(), reset: vi.fn() };
  const mockTraces: ITraceRepository = { findByTraceId: vi.fn() };
  const mockLlm: ILLMProvider = { analyze: vi.fn() };
  const mockNotifier: INotifier = { send: vi.fn() };
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
  } as unknown as Logger;

  const analysis = {
    probable_cause: 'DB pool exhaustion',
    impacted_services: ['payments-api'],
    recommended_steps: ['Scale DB'],
    urgency_level: 'critical' as const,
    requires_rollback: true,
  };

  function makeResult(overrides: Partial<RuleActionResult> = {}): RuleActionResult {
    return {
      suppressed: false,
      actions: [],
      tags: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDedup.isNew).mockResolvedValue({ isNew: true, ttlSeconds: 300 });
    vi.mocked(mockTraces.findByTraceId).mockResolvedValue([]);
    vi.mocked(mockLlm.analyze).mockResolvedValue(analysis);
    vi.mocked(mockNotifier.send).mockResolvedValue(undefined);
  });

  it('PRE-LLM Route action — notification is sent to the correct channel', async () => {
    const routeActions: RuleAction[] = [
      { type: RuleActionType.Route, channel: 'slack-sre' },
    ];
    const mockRuleEngine: IRuleEngine = {
      evaluatePreLlm: vi.fn().mockReturnValue(makeResult({ actions: routeActions })),
      evaluatePostLlm: vi.fn().mockReturnValue(makeResult()),
    };

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-route' })], 'corr-route');

    // LLM still proceeds (Route does NOT suppress)
    expect(mockLlm.analyze).toHaveBeenCalledOnce();
    // Notification sent with channel override
    expect(mockNotifier.send).toHaveBeenCalledWith(
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

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-esc' })], 'corr-esc');

    // Default notification fires
    expect(mockNotifier.send).toHaveBeenCalled();
    // Escalate action adds channel parameter
    const calls = vi.mocked(mockNotifier.send).mock.calls;
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

    const uc = new ProcessIncidentUseCase({
      dedup: mockDedup, traces: mockTraces, llm: mockLlm, notifier: mockNotifier,
      logger: mockLogger, dedupTtlSeconds: 300, ruleEngine: mockRuleEngine,
    });

    await uc.execute([makeAlert({ serviceName: 'svc-post-esc' })], 'corr-post-esc');

    expect(mockRuleEngine.evaluatePostLlm).toHaveBeenCalledOnce();
    // Escalate action produces channel param in notification
    const calls = vi.mocked(mockNotifier.send).mock.calls;
    const escalateCall = calls.find((c) => c[2] === 'pagerduty-critical');
    expect(escalateCall).toBeDefined();
  });
});
