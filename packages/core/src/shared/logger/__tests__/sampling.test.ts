import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldSample } from '../sampling.js';
import { Component } from '../enums.js';
import type { WideEvent } from '../wide-event-builder.js';

const SLOW_THRESHOLD_MS = 10_000;
const SAMPLE_RUNS = 1000;
const MIN_EXPECTED_RATE = 0.02;
const MAX_EXPECTED_RATE = 0.08;

function baseEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    requestId: 'req-1',
    component: Component.Worker,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldSample', () => {
  it('always samples events with an error, regardless of the random draw', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const event = baseEvent({ error: { message: 'boom' }, durationMs: 5 });

    expect(shouldSample(event)).toBe(true);
  });

  it('always samples events slower than 10s, regardless of the random draw', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const event = baseEvent({ durationMs: SLOW_THRESHOLD_MS + 1 });

    expect(shouldSample(event)).toBe(true);
  });

  it('samples a normal event when the random draw falls below 5%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.04);

    expect(shouldSample(baseEvent({ durationMs: 100 }))).toBe(true);
  });

  it('skips a normal event when the random draw falls above 5%', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.06);

    expect(shouldSample(baseEvent({ durationMs: 100 }))).toBe(false);
  });

  it('treats exactly 10s as a normal event (threshold is strictly greater)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);

    expect(shouldSample(baseEvent({ durationMs: SLOW_THRESHOLD_MS }))).toBe(false);
  });

  it('treats a missing durationMs as a normal event', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);

    expect(shouldSample(baseEvent())).toBe(false);
  });

  it('samples roughly 5% of normal events over 1000 runs', () => {
    let sampled = 0;
    for (let i = 0; i < SAMPLE_RUNS; i++) {
      if (shouldSample(baseEvent({ durationMs: 100 }))) {
        sampled++;
      }
    }

    const rate = sampled / SAMPLE_RUNS;
    expect(rate).toBeGreaterThanOrEqual(MIN_EXPECTED_RATE);
    expect(rate).toBeLessThanOrEqual(MAX_EXPECTED_RATE);
  });
});
