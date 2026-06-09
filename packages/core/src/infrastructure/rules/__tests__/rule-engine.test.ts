import { describe, it, expect } from 'vitest';
import { AlertType } from '../../../shared/constants.js';
import {
  RuleActionType,
  RuleEvaluationPhase,
} from '../../../domain/entities/rule.js';
import type { ValidatedRuleConfiguration } from '../../../domain/entities/rule.js';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';

// Import the class under test — does NOT exist yet (RED)
import { RuleEngine } from '../rule-engine.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST. rule-engine.ts does NOT exist yet.
// ─────────────────────────────────────────────────────────────────────────────

const baseCluster: AlertCluster = {
  fingerprint: 'abc123',
  serviceName: 'payments-api',
  alertType: AlertType.Error,
  endpointPath: '/api/payments',
  alertCount: 15,
  representativeTraceIds: ['trace-1'],
  firstSeenAt: '2026-06-09T12:00:00.000Z',
  latencyP99Ms: 450,
};

const baseAnalysis: LLMAnalysis = {
  probable_cause: 'DB pool exhausted',
  impacted_services: ['payments-api'],
  recommended_steps: ['Scale up'],
  urgency_level: 'critical',
  requires_rollback: true,
};

function makeConfig(overrides?: Partial<ValidatedRuleConfiguration>): ValidatedRuleConfiguration {
  return {
    [RuleEvaluationPhase.PreLlm]: { rules: [] },
    [RuleEvaluationPhase.PostLlm]: { rules: [] },
    ...overrides,
  };
}

describe('RuleEngine — evaluatePreLlm', () => {
  it('returns pass-through when no rules are configured', () => {
    const config = makeConfig();
    const engine = new RuleEngine(config);

    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.suppressed).toBe(false);
    expect(result.actions).toEqual([]);
    expect(result.matchedRuleId).toBeUndefined();
    expect(result.tags).toEqual({});
  });

  it('returns pass-through when no rule matches', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PreLlm]: {
        rules: [
          {
            id: 'never-matches',
            name: 'Never matches',
            condition: { serviceName: 'nonexistent-service' },
            actions: [{ type: RuleActionType.Suppress }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.suppressed).toBe(false);
    expect(result.matchedRuleId).toBeUndefined();
  });

  it('matches a Suppress rule and returns suppressed', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PreLlm]: {
        rules: [
          {
            id: 'suppress-payments',
            condition: { serviceName: 'payments-api' },
            actions: [{ type: RuleActionType.Suppress }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.suppressed).toBe(true);
    expect(result.matchedRuleId).toBe('suppress-payments');
  });

  it('matches a Route rule and returns route action', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PreLlm]: {
        rules: [
          {
            id: 'route-sre',
            condition: { serviceName: 'payments-api' },
            actions: [{ type: RuleActionType.Route, channel: 'slack-sre' }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.suppressed).toBe(false);
    expect(result.matchedRuleId).toBe('route-sre');
    expect(result.actions).toEqual([
      { type: RuleActionType.Route, channel: 'slack-sre' },
    ]);
  });

  it('matches rule with multiple conditions (AND logic)', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PreLlm]: {
        rules: [
          {
            id: 'multi-match',
            condition: {
              serviceName: 'payments-api',
              alertCount: { min: 10 },
            },
            actions: [{ type: RuleActionType.Suppress }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.suppressed).toBe(true);
    expect(result.matchedRuleId).toBe('multi-match');
  });

  it('does NOT match when one condition fails (AND logic)', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PreLlm]: {
        rules: [
          {
            id: 'wont-match',
            condition: {
              serviceName: 'payments-api',
              alertCount: { min: 50 }, // cluster has 15
            },
            actions: [{ type: RuleActionType.Suppress }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.suppressed).toBe(false);
  });

  it('first-match-wins: only first matching rule is evaluated', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PreLlm]: {
        rules: [
          {
            id: 'first-match',
            condition: { serviceName: 'payments-api' },
            actions: [{ type: RuleActionType.Suppress }],
          },
          {
            id: 'second-match',
            condition: { serviceName: 'payments-api' },
            actions: [{ type: RuleActionType.Route, channel: 'other' }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.matchedRuleId).toBe('first-match');
    expect(result.suppressed).toBe(true);
    // Second rule's action should NOT be included
    expect(result.actions).toEqual([]);
  });

  it('skips non-matching rules and evaluates next matching rule', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PreLlm]: {
        rules: [
          {
            id: 'skip-this',
            condition: { serviceName: 'other-service' },
            actions: [{ type: RuleActionType.Suppress }],
          },
          {
            id: 'match-this',
            condition: { serviceName: 'payments-api' },
            actions: [{ type: RuleActionType.Route, channel: 'slack-sre' }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePreLlm(baseCluster);
    expect(result.matchedRuleId).toBe('match-this');
    expect(result.actions).toEqual([
      { type: RuleActionType.Route, channel: 'slack-sre' },
    ]);
  });
});

describe('RuleEngine — evaluatePostLlm', () => {
  it('returns pass-through when no post-llm rules match', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PostLlm]: {
        rules: [
          {
            id: 'no-match',
            condition: { urgencyLevel: 'low' },
            actions: [{ type: RuleActionType.Tag, key: 'x', value: 'y' }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePostLlm(baseCluster, baseAnalysis);
    expect(result.suppressed).toBe(false);
    expect(result.matchedRuleId).toBeUndefined();
    expect(result.tags).toEqual({});
  });

  it('matches post-llm rule with urgencyLevel and requiresRollback', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PostLlm]: {
        rules: [
          {
            id: 'critical-rollback',
            condition: {
              urgencyLevel: 'critical',
              requiresRollback: true,
            },
            actions: [
              { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
              { type: RuleActionType.Tag, key: 'incident-class', value: 'rollback-required' },
            ],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePostLlm(baseCluster, baseAnalysis);
    expect(result.matchedRuleId).toBe('critical-rollback');
    expect(result.actions).toEqual([
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ]);
    expect(result.tags).toEqual({ 'incident-class': 'rollback-required' });
  });

  it('first-match-wins for post-llm rules', () => {
    const config = makeConfig({
      [RuleEvaluationPhase.PostLlm]: {
        rules: [
          {
            id: 'first-post',
            condition: { urgencyLevel: 'critical' },
            actions: [{ type: RuleActionType.Tag, key: 'matched', value: 'first' }],
          },
          {
            id: 'second-post',
            condition: { urgencyLevel: 'critical' },
            actions: [{ type: RuleActionType.Tag, key: 'matched', value: 'second' }],
          },
        ],
      },
    });
    const engine = new RuleEngine(config);
    const result = engine.evaluatePostLlm(baseCluster, baseAnalysis);
    expect(result.matchedRuleId).toBe('first-post');
    expect(result.tags).toEqual({ matched: 'first' });
  });
});
