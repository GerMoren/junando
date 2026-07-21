/**
 * Pipeline component taxonomy.
 *
 * `component` (not `service`) distinguishes pipeline stages in wide events.
 * `service` stays constant ("junando"); `component` tells you WHERE the event
 * was emitted from.
 */
export const Component = {
  Webhook: 'webhook',
  Worker: 'worker',
  UseCase: 'useCase',
  Llm: 'llm',
  Notifier: 'notifier',
  Dedup: 'dedup',
  Traces: 'traces',
  Ingest: 'ingest',
} as const;
export type Component = (typeof Component)[keyof typeof Component];

/**
 * Pipeline stages that write their results into the WideEventBuilder.
 */
export const Stage = {
  Dedup: 'dedup',
  RulesPre: 'rulesPre',
  Traces: 'traces',
  Llm: 'llm',
  RulesPost: 'rulesPost',
  Notify: 'notify',
} as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

/**
 * Terminal outcomes for a wide event across all entry points.
 */
export const Outcome = {
  Success: 'success',
  Suppressed: 'suppressed',
  Degraded: 'degraded',
  Error: 'error',
  Accepted: 'accepted',
  Empty: 'empty',
  ParseError: 'parse_error',
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

/**
 * Reason recorded for a tail-sampling decision.
 */
export const SamplingDecision = {
  Error: 'error',
  Slow: 'slow',
  Random: 'random',
  Skipped: 'skipped',
} as const;
export type SamplingDecision = (typeof SamplingDecision)[keyof typeof SamplingDecision];
