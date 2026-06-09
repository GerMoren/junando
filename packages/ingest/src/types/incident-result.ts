import type { NormalizedAlert } from '@junando/core';

/**
 * Processing outcome status for a single NormalizedAlert run through
 * the IncidentProcessor pipeline.
 */
export type IncidentStatus = 'success' | 'partial' | 'error';

/**
 * Result returned by IngestService.process() and IncidentProcessor.process().
 *
 * Mirrors PipelineOptions shape in `stages` so consumers see at a glance
 * which stages executed vs. which were requested.
 */
export interface IncidentResult {
  /** The alert that was processed (may be mutated by pipeline stages). */
  alert: NormalizedAlert;
  /** Which pipeline stages actually ran. Symmetric with PipelineOptions. */
  stages: {
    llmAnalysis: boolean;
    notifications: boolean;
    traceabilityIndexing: boolean;
  };
  /** Overall outcome of the processing run. */
  status: IncidentStatus;
  /** Error details when status is 'error'. */
  error?: Error;
}
