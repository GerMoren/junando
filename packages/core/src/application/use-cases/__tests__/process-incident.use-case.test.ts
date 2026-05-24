import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessIncidentUseCase } from '../process-incident.use-case.js';
import type { NormalizedAlert } from '../../../domain/entities/alert.js';
import type {
  IDeduplicationStore,
  ITraceRepository,
  ILLMProvider,
  INotifier,
} from '../../../domain/ports/index.js';
import type { Logger } from '../../../shared/logger/index.js';
import { AlertType } from '../../../shared/constants.js';
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

    vi.mocked(mockDedup.isNew).mockResolvedValue(true);
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

    vi.mocked(mockDedup.isNew).mockResolvedValue(false);
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

    vi.mocked(mockDedup.isNew).mockResolvedValue(true);
    vi.mocked(mockTraces.findByTraceId).mockResolvedValue([]);
    vi.mocked(mockLlm.analyze).mockRejectedValue(new Error('LLM Down'));
    vi.mocked(mockNotifier.send).mockClear();

    await useCase.execute([alert], 'corr-3');

    expect(mockLlm.analyze).toHaveBeenCalled();
    expect(mockNotifier.send).toHaveBeenCalledWith(expect.anything(), null);
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

    vi.mocked(mockDedup.isNew).mockResolvedValue(false); // skip inner processing
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

    vi.mocked(mockDedup.isNew).mockResolvedValue(false);

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
    vi.mocked(mockDedup.isNew).mockResolvedValue(true);
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
    vi.mocked(mockDedup.isNew).mockResolvedValue(false);
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
    vi.mocked(mockDedup.isNew).mockResolvedValue(true);
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
