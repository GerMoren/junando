import { describe, it, expect, vi } from 'vitest';
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
