/**
 * Per-call pipeline stage toggles passed to IngestService.process().
 *
 * Every toggle is optional and defaults to `true` when omitted or `undefined`.
 * Setting a toggle to `false` disables that stage for the current call.
 */
export interface PipelineOptions {
  /** Enable the LLM diagnosis stage. Default: true. */
  enableLlmAnalysis?: boolean;
  /** Enable the notification dispatch stage. Default: true. */
  enableNotifications?: boolean;
  /** Enable the traceability indexing stage. Default: true. */
  enableTraceabilityIndexing?: boolean;
}

/**
 * Resolved (fully populated) options — all fields are concrete booleans.
 */
export type ResolvedPipelineOptions = Required<PipelineOptions>;
