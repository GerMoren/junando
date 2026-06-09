/**
 * TraceabilityIncidentProcessor — implements IncidentProcessor.
 *
 * Delegates to ProcessIncidentUseCase for full incident processing
 * (clustering, dedup, LLM analysis, notifications, traceability indexing).
 *
 * Note: PipelineOptions toggles (enableLlmAnalysis, enableNotifications,
 * enableTraceabilityIndexing) are not yet wired to ProcessIncidentUseCase.
 * A future PR can extend ProcessIncidentUseCase to accept pipeline options.
 */
import type { NormalizedAlert } from '@junando/core';
import type { ProcessIncidentUseCase } from '../../../packages/core/src/index.js';
import type { IncidentProcessor } from '../../../packages/ingest/src/ports/incident-processor.port.js';
import type { IncidentResult } from '../../../packages/ingest/src/types/incident-result.js';
import type { PipelineOptions } from '../../../packages/ingest/src/types/pipeline-options.js';

function resolveStage(value: boolean | undefined, defaultValue: boolean): boolean {
  return value ?? defaultValue;
}

export function createTraceabilityIncidentProcessor(deps: {
  processIncidentUseCase: Pick<ProcessIncidentUseCase, 'execute'>;
}): IncidentProcessor {
  return {
    async process(alert: NormalizedAlert, options: PipelineOptions): Promise<IncidentResult> {
      const stages = {
        llmAnalysis: resolveStage(options.enableLlmAnalysis, true),
        notifications: resolveStage(options.enableNotifications, true),
        traceabilityIndexing: resolveStage(options.enableTraceabilityIndexing, true),
      };

      try {
        await deps.processIncidentUseCase.execute([alert], alert.fingerprint);
        return { alert, stages, status: 'success' };
      } catch (err) {
        return {
          alert,
          stages,
          status: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
  };
}