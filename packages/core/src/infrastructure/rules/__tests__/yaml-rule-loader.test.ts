import { describe, it, expect } from 'vitest';
import {
  RuleActionType,
  SeverityLevel,
  RuleEvaluationPhase,
} from '../../../domain/entities/rule.js';
import { AlertType } from '../../../shared/constants.js';
// Import the function under test — does NOT exist yet (RED)
import { parseRuleConfig } from '../yaml-rule-loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST. yaml-rule-loader.ts does NOT exist yet.
// ─────────────────────────────────────────────────────────────────────────────

const validYaml = `
pre-llm:
  rules:
    - id: suppress-noise
      name: Suppress known noise
      condition:
        serviceName: legacy-api
        alertType: http_500
      actions:
        - type: suppress

    - id: route-critical
      condition:
        serviceName: payments-api
        severity: critical
        alertCount:
          min: 5
      actions:
        - type: route
          channel: slack-sre
        - type: escalate
          channel: pagerduty-critical

post-llm:
  rules:
    - id: escalate-rollback
      condition:
        urgencyLevel: critical
        requiresRollback: true
      actions:
        - type: escalate
          channel: pagerduty-critical
        - type: tag
          key: incident-class
          value: rollback-required
`;

describe('parseRuleConfig', () => {
  it('parses a valid rules.yaml with pre-llm and post-llm sections', () => {
    const config = parseRuleConfig(validYaml);

    expect(config).toBeDefined();

    // Pre-llm section
    const preLlm = config[RuleEvaluationPhase.PreLlm];
    expect(preLlm.rules).toHaveLength(2);

    // First pre-llm rule: suppress-noise
    const rule1 = preLlm.rules[0];
    expect(rule1.id).toBe('suppress-noise');
    expect(rule1.name).toBe('Suppress known noise');
    expect(rule1.condition.serviceName).toBe('legacy-api');
    expect(rule1.condition.alertType).toBe(AlertType.Error);
    expect(rule1.actions).toHaveLength(1);
    expect(rule1.actions[0].type).toBe(RuleActionType.Suppress);

    // Second pre-llm rule: route-critical (multiple actions)
    const rule2 = preLlm.rules[1];
    expect(rule2.id).toBe('route-critical');
    expect(rule2.condition.severity).toBe(SeverityLevel.Critical);
    expect(rule2.condition.alertCount).toEqual({ min: 5 });
    expect(rule2.actions).toHaveLength(2);
    expect(rule2.actions[0]).toEqual({ type: RuleActionType.Route, channel: 'slack-sre' });
    expect(rule2.actions[1]).toEqual({ type: RuleActionType.Escalate, channel: 'pagerduty-critical' });

    // Post-llm section
    const postLlm = config[RuleEvaluationPhase.PostLlm];
    expect(postLlm.rules).toHaveLength(1);

    const rule3 = postLlm.rules[0];
    expect(rule3.id).toBe('escalate-rollback');
    expect(rule3.condition.urgencyLevel).toBe('critical');
    expect(rule3.condition.requiresRollback).toBe(true);
    expect(rule3.actions).toHaveLength(2);
    expect(rule3.actions[0]).toEqual({ type: RuleActionType.Escalate, channel: 'pagerduty-critical' });
    expect(rule3.actions[1]).toEqual({ type: RuleActionType.Tag, key: 'incident-class', value: 'rollback-required' });
  });

  it('rejects YAML with an unknown action type', () => {
    const badYaml = `
pre-llm:
  rules:
    - id: bad-rule
      condition:
        serviceName: test
      actions:
        - type: banana
post-llm:
  rules: []
`;

    expect(() => parseRuleConfig(badYaml)).toThrow();
  });

  it('rejects YAML with missing required fields (no id)', () => {
    const missingIdYaml = `
pre-llm:
  rules:
    - condition:
        serviceName: test
      actions:
        - type: suppress
post-llm:
  rules: []
`;

    expect(() => parseRuleConfig(missingIdYaml)).toThrow();
  });

  it('rejects malformed YAML (bad syntax)', () => {
    const malformedYaml = `pre-llm: [this is: broken: yaml: ::::`;
    expect(() => parseRuleConfig(malformedYaml)).toThrow();
  });

  it('parses empty sections as valid (no rules)', () => {
    const emptyYaml = `
pre-llm:
  rules: []
post-llm:
  rules: []
`;
    const config = parseRuleConfig(emptyYaml);
    expect(config[RuleEvaluationPhase.PreLlm].rules).toHaveLength(0);
    expect(config[RuleEvaluationPhase.PostLlm].rules).toHaveLength(0);
  });

  it('parses label conditions correctly', () => {
    const labelYaml = `
pre-llm:
  rules:
    - id: label-rule
      condition:
        labels:
          environment: staging
          team: payments
      actions:
        - type: suppress
post-llm:
  rules: []
`;
    const config = parseRuleConfig(labelYaml);
    const rule = config[RuleEvaluationPhase.PreLlm].rules[0];
    expect(rule.condition.labels).toEqual({ environment: 'staging', team: 'payments' });
  });

  it('parses numeric range conditions correctly', () => {
    const rangeYaml = `
pre-llm:
  rules:
    - id: range-rule
      condition:
        alertCount:
          min: 10
          max: 500
        latencyP99Ms:
          min: 200
      actions:
        - type: suppress
post-llm:
  rules: []
`;
    const config = parseRuleConfig(rangeYaml);
    const rule = config[RuleEvaluationPhase.PreLlm].rules[0];
    expect(rule.condition.alertCount).toEqual({ min: 10, max: 500 });
    expect(rule.condition.latencyP99Ms).toEqual({ min: 200 });
  });

  it('parses partial range conditions (only min or only max)', () => {
    const partialYaml = `
pre-llm:
  rules:
    - id: partial-range
      condition:
        alertCount:
          max: 50
        latencyP99Ms:
          min: 100
      actions:
        - type: suppress
post-llm:
  rules: []
`;
    const config = parseRuleConfig(partialYaml);
    const rule = config[RuleEvaluationPhase.PreLlm].rules[0];
    expect(rule.condition.alertCount).toEqual({ max: 50 });
    expect(rule.condition.latencyP99Ms).toEqual({ min: 100 });
  });

  it('parses endpointPath condition', () => {
    const endpointYaml = `
pre-llm:
  rules:
    - id: endpoint-rule
      condition:
        endpointPath: /api/payments
      actions:
        - type: suppress
post-llm:
  rules: []
`;
    const config = parseRuleConfig(endpointYaml);
    const rule = config[RuleEvaluationPhase.PreLlm].rules[0];
    expect(rule.condition.endpointPath).toBe('/api/payments');
  });

  it('parses post-llm conditions with impactedServices array', () => {
    const impactedYaml = `
pre-llm:
  rules: []
post-llm:
  rules:
    - id: multi-service
      condition:
        impactedServices:
          - payments-api
          - inventory-api
      actions:
        - type: tag
          key: scope
          value: multi-service
`;
    const config = parseRuleConfig(impactedYaml);
    const rule = config[RuleEvaluationPhase.PostLlm].rules[0];
    expect(rule.condition.impactedServices).toEqual(['payments-api', 'inventory-api']);
  });
});
