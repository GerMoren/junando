import type { WideEvent } from './wide-event-builder.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tail sampling — decided at flush time so errors and slow events are never
// lost: errors 100%, durationMs > 10s 100%, everything else ~5%.
// ─────────────────────────────────────────────────────────────────────────────

/** Events slower than this (ms) are always sampled. */
export const SLOW_EVENT_THRESHOLD_MS = 10_000;

/** Probability of sampling a normal (non-error, non-slow) event. */
export const NORMAL_SAMPLE_RATE = 0.05;

/**
 * Decides whether a wide event should be emitted.
 *
 * Pure function over the event — the only non-determinism is Math.random()
 * for the normal path, which tests can stub.
 */
export function shouldSample(event: WideEvent): boolean {
  if (event.error != null) {
    return true;
  }
  if (event.durationMs !== undefined && event.durationMs > SLOW_EVENT_THRESHOLD_MS) {
    return true;
  }
  return Math.random() < NORMAL_SAMPLE_RATE;
}
