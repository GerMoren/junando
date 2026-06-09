/**
 * IncidentProcessor port.
 *
 * Defines the boundary between IngestService and the incident processing
 * pipeline. Implementations live in @junando/core or consumer repos.
 * Tests inject a vi.fn() implementation — no real processing needed.
 *
 * This interface does NOT import any non-re-exported type from @junando/core.
 */
import type { NormalizedAlert } from '@junando/core';
import type { PipelineOptions } from '../types/pipeline-options.js';
import type { IncidentResult } from '../types/incident-result.js';

export interface IncidentProcessor {
  /**
   * Process a normalized alert through the pipeline.
   *
   * @param alert — A domain-valid NormalizedAlert.
   * @param options — Resolved pipeline options (all fields are concrete booleans).
   * @returns The processing outcome as an IncidentResult.
   */
  process(alert: NormalizedAlert, options: PipelineOptions): Promise<IncidentResult>;
}
