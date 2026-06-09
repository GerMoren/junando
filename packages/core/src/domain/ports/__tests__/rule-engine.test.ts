import { describe, it, expect } from 'vitest';
import type { AlertCluster } from '../../entities/cluster.js';
import type { LLMAnalysis } from '../../entities/incident.js';
import type { IRuleEngine, RuleActionResult } from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: Structural test — verifies IRuleEngine interface contract
// ─────────────────────────────────────────────────────────────────────────────

describe('IRuleEngine port', () => {
  it('accepts a valid mock implementation satisfying the interface', () => {
    // Compile-time check: this object satisfies IRuleEngine
    const mockEngine: IRuleEngine = {
      evaluatePreLlm(_cluster: AlertCluster): RuleActionResult {
        return { suppressed: false, actions: [], tags: {} };
      },
      evaluatePostLlm(_cluster: AlertCluster, _analysis: LLMAnalysis): RuleActionResult {
        return { suppressed: false, actions: [], tags: {} };
      },
    };

    expect(mockEngine).toBeDefined();
    expect(typeof mockEngine.evaluatePreLlm).toBe('function');
    expect(typeof mockEngine.evaluatePostLlm).toBe('function');
  });

  it('evaluatePreLlm returns pass-through when no rules match', () => {
    const mockEngine: IRuleEngine = {
      evaluatePreLlm(): RuleActionResult {
        return { suppressed: false, actions: [], tags: {} };
      },
      evaluatePostLlm(): RuleActionResult {
        return { suppressed: false, actions: [], tags: {} };
      },
    };

    const result = mockEngine.evaluatePreLlm({} as AlertCluster);

    expect(result.suppressed).toBe(false);
    expect(result.actions).toEqual([]);
    expect(result.tags).toEqual({});
  });

  it('evaluatePostLlm receives cluster and analysis', () => {
    let capturedAnalysis: LLMAnalysis | undefined;

    const mockEngine: IRuleEngine = {
      evaluatePreLlm(): RuleActionResult {
        return { suppressed: false, actions: [], tags: {} };
      },
      evaluatePostLlm(_cluster: AlertCluster, analysis: LLMAnalysis): RuleActionResult {
        capturedAnalysis = analysis;
        return {
          suppressed: false,
          actions: [],
          tags: { urgency: analysis.urgency_level },
        };
      },
    };

    const analysis: LLMAnalysis = {
      probable_cause: 'DB timeout',
      impacted_services: ['payments-api'],
      recommended_steps: ['Restart DB'],
      urgency_level: 'critical',
      requires_rollback: false,
    };

    const result = mockEngine.evaluatePostLlm({} as AlertCluster, analysis);

    expect(capturedAnalysis).toBe(analysis);
    expect(result.tags.urgency).toBe('critical');
  });

  it('RuleActionResult with matchedRuleId is accepted', () => {
    const result: RuleActionResult = {
      suppressed: true,
      actions: [],
      matchedRuleId: 'suppress-known-false-positive',
      tags: { status: 'suppressed' },
    };

    expect(result.suppressed).toBe(true);
    expect(result.matchedRuleId).toBe('suppress-known-false-positive');
    expect(result.tags).toEqual({ status: 'suppressed' });
  });
});
