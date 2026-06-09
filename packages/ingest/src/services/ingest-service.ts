/**
 * IngestService — transport-agnostic entry point for processing normalized alerts.
 *
 * Accepts a NormalizedAlert and delegates to an injected IncidentProcessor.
 * Configuration is per-call via optional PipelineOptions with three boolean
 * toggles, all defaulting to true. Errors from the processor are caught and
 * wrapped in IncidentResult — the service never throws.
 */
import { NormalizedAlertSchema } from '@junando/core';
import type { NormalizedAlert } from '@junando/core';
import type { IncidentProcessor } from '../ports/incident-processor.port.js';
import type { IncidentResult } from '../types/incident-result.js';
import type { PipelineOptions } from '../types/pipeline-options.js';

const DEFAULT_OPTIONS: Required<PipelineOptions> = {
  enableLlmAnalysis: true,
  enableNotifications: true,
  enableTraceabilityIndexing: true,
};

const ALL_FALSE_STAGES: IncidentResult['stages'] = {
  llmAnalysis: false,
  notifications: false,
  traceabilityIndexing: false,
};

export class IngestService {
  private readonly processor: IncidentProcessor;

  constructor(processor: IncidentProcessor) {
    this.processor = processor;
  }

  /**
   * Process a normalized alert through the configured pipeline.
   *
   * @param alert — A domain-valid NormalizedAlert. Schema-validated on entry.
   * @param options — Optional per-call pipeline stage toggles. All default to true.
   * @returns IncidentResult with processing status. NEVER throws.
   */
  async process(alert: NormalizedAlert, options?: PipelineOptions): Promise<IncidentResult> {
    // 1. Validate the alert shape
    const parseResult = NormalizedAlertSchema.safeParse(alert);
    if (!parseResult.success) {
      return {
        alert,
        stages: ALL_FALSE_STAGES,
        status: 'error',
        error: parseResult.error,
      };
    }

    // 2. Merge caller options with defaults
    const resolvedOptions: Required<PipelineOptions> = { ...DEFAULT_OPTIONS, ...options };

    // 3. Delegate to injected processor, wrapping any thrown errors
    try {
      return await this.processor.process(parseResult.data, resolvedOptions);
    } catch (err) {
      return {
        alert: parseResult.data,
        stages: ALL_FALSE_STAGES,
        status: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
