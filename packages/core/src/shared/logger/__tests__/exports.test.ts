import { describe, it, expect } from 'vitest';

import * as loggerIndex from '../index.js';
import { WideEventBuilder } from '../wide-event-builder.js';
import { shouldSample } from '../sampling.js';
import { redact } from '../redaction.js';
import { Component, Outcome, Stage, SamplingDecision } from '../enums.js';

describe('logger index exports', () => {
  it('re-exports WideEventBuilder from the wide-event-builder module', () => {
    expect(loggerIndex.WideEventBuilder).toBe(WideEventBuilder);
  });

  it('re-exports shouldSample from the sampling module', () => {
    expect(loggerIndex.shouldSample).toBe(shouldSample);
  });

  it('re-exports redact from the redaction module', () => {
    expect(loggerIndex.redact).toBe(redact);
  });

  it('re-exports the logger enums', () => {
    expect(loggerIndex.Component).toBe(Component);
    expect(loggerIndex.Outcome).toBe(Outcome);
    expect(loggerIndex.Stage).toBe(Stage);
    expect(loggerIndex.SamplingDecision).toBe(SamplingDecision);
  });

  it('keeps the pre-existing logger factory exports', () => {
    expect(typeof loggerIndex.createLogger).toBe('function');
    expect(typeof loggerIndex.reinitLogger).toBe('function');
  });
});
