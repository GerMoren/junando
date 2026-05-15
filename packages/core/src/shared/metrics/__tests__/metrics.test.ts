import { describe, it, expect } from 'vitest';
import { llmInferenceDuration } from '../index.js';

describe('metrics', () => {
  describe('llmInferenceDuration histogram', () => {
    it('includes "model" in labelNames', () => {
      expect(llmInferenceDuration.labelNames).toContain('model');
    });
  });
});
