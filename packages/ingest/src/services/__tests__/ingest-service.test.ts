import { describe, it, expect, vi } from 'vitest';
import { AlertType } from '@junando/core';
import type { NormalizedAlert } from '@junando/core';
import type { IncidentProcessor } from '../../ports/incident-processor.port.js';
import type { IncidentResult } from '../../types/incident-result.js';
import type { PipelineOptions } from '../../types/pipeline-options.js';
import { IngestService } from '../ingest-service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    fingerprint: 'abc123',
    alertName: 'test-alert',
    status: 'firing',
    serviceName: 'test-svc',
    alertType: AlertType.Error,
    endpointPath: '/test',
    startsAt: '2025-01-01T00:00:00.000Z',
    labels: {},
    annotations: {},
    ...overrides,
  };
}

function makeResult(overrides: Partial<IncidentResult> = {}): IncidentResult {
  return {
    alert: makeAlert(),
    stages: { llmAnalysis: true, notifications: true, traceabilityIndexing: true },
    status: 'success',
    ...overrides,
  };
}

/** Options with all three toggles explicitly set to true. */
const ALL_TRUE: PipelineOptions & { enableLlmAnalysis: true; enableNotifications: true; enableTraceabilityIndexing: true } = {
  enableLlmAnalysis: true,
  enableNotifications: true,
  enableTraceabilityIndexing: true,
};

/** Options with all three toggles explicitly set to false. */
const ALL_FALSE: PipelineOptions = {
  enableLlmAnalysis: false,
  enableNotifications: false,
  enableTraceabilityIndexing: false,
};

// ---------------------------------------------------------------------------
// Phase 1: Options resolution tests (RED — service not yet implemented)
// ---------------------------------------------------------------------------

describe('IngestService — options resolution', () => {
  it('1. default pipeline (no options) → processor receives all-true options', async () => {
    const processor: IncidentProcessor = { process: vi.fn().mockResolvedValue(makeResult()) };
    const service = new IngestService(processor);
    const alert = makeAlert();

    await service.process(alert);

    expect(processor.process).toHaveBeenCalledWith(alert, ALL_TRUE);
  });

  it('2. default pipeline (empty options {}) → processor receives all-true options', async () => {
    const processor: IncidentProcessor = { process: vi.fn().mockResolvedValue(makeResult()) };
    const service = new IngestService(processor);
    const alert = makeAlert();

    await service.process(alert, {});

    expect(processor.process).toHaveBeenCalledWith(alert, ALL_TRUE);
  });

  it('3. disable LLM only → notifications + traceability remain true', async () => {
    const processor: IncidentProcessor = { process: vi.fn().mockResolvedValue(makeResult()) };
    const service = new IngestService(processor);
    const alert = makeAlert();

    await service.process(alert, { enableLlmAnalysis: false });

    expect(processor.process).toHaveBeenCalledWith(alert, {
      enableLlmAnalysis: false,
      enableNotifications: true,
      enableTraceabilityIndexing: true,
    });
  });

  it('4. all stages disabled → processor receives all-false options', async () => {
    const processor: IncidentProcessor = { process: vi.fn().mockResolvedValue(makeResult()) };
    const service = new IngestService(processor);
    const alert = makeAlert();

    await service.process(alert, ALL_FALSE);

    expect(processor.process).toHaveBeenCalledWith(alert, ALL_FALSE);
  });

  it('5. partial pipeline — indexing only → only traceabilityIndexing is true', async () => {
    const processor: IncidentProcessor = { process: vi.fn().mockResolvedValue(makeResult()) };
    const service = new IngestService(processor);
    const alert = makeAlert();

    await service.process(alert, {
      enableLlmAnalysis: false,
      enableNotifications: false,
    });

    expect(processor.process).toHaveBeenCalledWith(alert, {
      enableLlmAnalysis: false,
      enableNotifications: false,
      enableTraceabilityIndexing: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Error handling tests (RED — error branches not yet implemented)
// ---------------------------------------------------------------------------

describe('IngestService — error handling', () => {
  it('6. processor throws → returns result with status "error" and attached error', async () => {
    const processorError = new Error('LLM service unavailable');
    const processor: IncidentProcessor = { process: vi.fn().mockRejectedValue(processorError) };
    const service = new IngestService(processor);
    const alert = makeAlert();

    const result = await service.process(alert);

    expect(result.status).toBe('error');
    expect(result.error).toBe(processorError);
    expect(result.alert).toEqual(alert);
    expect(result.stages).toEqual({ llmAnalysis: false, notifications: false, traceabilityIndexing: false });
  });

  it('7. invalid NormalizedAlert (missing fingerprint) → returns result with status "error"', async () => {
    const processor: IncidentProcessor = { process: vi.fn() };
    const service = new IngestService(processor);
    // Missing required field: fingerprint
    const invalidAlert = { alertName: 'no-fingerprint' } as unknown as NormalizedAlert;

    const result = await service.process(invalidAlert);

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
    expect(processor.process).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Integration / happy-path tests (RED — service not yet implemented)
// ---------------------------------------------------------------------------

describe('IngestService — integration', () => {
  it('8. happy path — mock processor returns result, service returns it unchanged', async () => {
    const expectedResult = makeResult({
      alert: makeAlert({ fingerprint: 'happy-path' }),
      status: 'success',
      stages: { llmAnalysis: true, notifications: true, traceabilityIndexing: true },
    });
    const processor: IncidentProcessor = { process: vi.fn().mockResolvedValue(expectedResult) };
    const service = new IngestService(processor);

    const result = await service.process(expectedResult.alert);

    expect(result).toBe(expectedResult);
    expect(result.status).toBe('success');
    expect(result.stages).toEqual({ llmAnalysis: true, notifications: true, traceabilityIndexing: true });
  });

  it('9. all stages disabled → processor called with all-false, result propagates', async () => {
    const expectedResult = makeResult({
      alert: makeAlert({ fingerprint: 'all-false-int' }),
      status: 'partial',
      stages: { llmAnalysis: false, notifications: false, traceabilityIndexing: false },
    });
    const processor: IncidentProcessor = { process: vi.fn().mockResolvedValue(expectedResult) };
    const service = new IngestService(processor);

    const result = await service.process(expectedResult.alert, ALL_FALSE);

    expect(processor.process).toHaveBeenCalledWith(expectedResult.alert, ALL_FALSE);
    expect(result.status).toBe('partial');
    expect(result).toBe(expectedResult);
  });
});
