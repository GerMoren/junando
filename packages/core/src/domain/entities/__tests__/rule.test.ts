import { describe, it, expect } from 'vitest';
import { AlertType } from '../../../shared/constants.js';
import {
  RuleConditionSchema,
  RuleActionSchema,
  RuleSchema,
  RuleSectionSchema,
  RuleConfigurationSchema,
} from '../rule.js';
import type { RuleConfiguration, RuleAction } from '../rule.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST. Production code in rule.ts does NOT exist yet.
// ─────────────────────────────────────────────────────────────────────────────

describe('RuleConditionSchema', () => {
  it('validates a minimal condition (all fields optional)', () => {
    const result = RuleConditionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates a full PRE-LLM condition with exact-match fields', () => {
    const condition = {
      serviceName: 'payments-api',
      alertType: AlertType.Error,
      severity: 'critical',
      endpointPath: '/api/pay',
      labels: { team: 'payments', env: 'production' },
    };
    const result = RuleConditionSchema.safeParse(condition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceName).toBe('payments-api');
      expect(result.data.alertType).toBe(AlertType.Error);
      expect(result.data.severity).toBe('critical');
      expect(result.data.labels).toEqual({ team: 'payments', env: 'production' });
    }
  });

  it('validates range conditions (alertCount, latencyP99Ms)', () => {
    const condition = {
      alertCount: { min: 10, max: 100 },
      latencyP99Ms: { min: 200 },
    };
    const result = RuleConditionSchema.safeParse(condition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alertCount).toEqual({ min: 10, max: 100 });
      expect(result.data.latencyP99Ms).toEqual({ min: 200 });
    }
  });

  it('validates POST-LLM-only fields (urgencyLevel, requiresRollback, impactedServices)', () => {
    const condition = {
      urgencyLevel: 'critical' as const,
      requiresRollback: true,
      impactedServices: ['payments-api', 'inventory-api'],
    };
    const result = RuleConditionSchema.safeParse(condition);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.urgencyLevel).toBe('critical');
      expect(result.data.requiresRollback).toBe(true);
      expect(result.data.impactedServices).toEqual(['payments-api', 'inventory-api']);
    }
  });

  it('rejects invalid alertType (not in enum)', () => {
    const result = RuleConditionSchema.safeParse({ alertType: 'INVALID_TYPE' });
    expect(result.success).toBe(false);
  });

  it('rejects non-object alertCount', () => {
    const result = RuleConditionSchema.safeParse({ alertCount: 'not-an-object' });
    expect(result.success).toBe(false);
  });
});

describe('RuleActionSchema (discriminated union)', () => {
  it('validates Suppress action', () => {
    const result = RuleActionSchema.safeParse({ type: 'suppress' });
    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data as RuleAction;
      expect(action.type).toBe('suppress');
    }
  });

  it('validates Route action with channel', () => {
    const result = RuleActionSchema.safeParse({ type: 'route', channel: 'slack-sre' });
    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data as RuleAction;
      expect(action.type).toBe('route');
      if (action.type === 'route') {
        expect(action.channel).toBe('slack-sre');
      }
    }
  });

  it('validates Escalate action with channel', () => {
    const result = RuleActionSchema.safeParse({ type: 'escalate', channel: 'pagerduty-critical' });
    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data as RuleAction;
      expect(action.type).toBe('escalate');
      if (action.type === 'escalate') {
        expect(action.channel).toBe('pagerduty-critical');
      }
    }
  });

  it('validates Tag action with key and value', () => {
    const result = RuleActionSchema.safeParse({ type: 'tag', key: 'team', value: 'dba' });
    expect(result.success).toBe(true);
    if (result.success) {
      const action = result.data as RuleAction;
      expect(action.type).toBe('tag');
      if (action.type === 'tag') {
        expect(action.key).toBe('team');
        expect(action.value).toBe('dba');
      }
    }
  });

  it('rejects unknown action type', () => {
    const result = RuleActionSchema.safeParse({ type: 'banana' });
    expect(result.success).toBe(false);
  });

  it('rejects Route action missing channel', () => {
    const result = RuleActionSchema.safeParse({ type: 'route' });
    expect(result.success).toBe(false);
  });

  it('rejects Tag action missing key', () => {
    const result = RuleActionSchema.safeParse({ type: 'tag', value: 'dba' });
    expect(result.success).toBe(false);
  });
});

describe('RuleSchema', () => {
  it('validates a complete rule with multiple actions', () => {
    const rule = {
      id: 'suppress-known-false-positive',
      name: 'Suppress Legacy API noise',
      condition: {
        serviceName: 'legacy-api',
        alertType: AlertType.Warning,
      },
      actions: [{ type: 'suppress' }],
    };
    const result = RuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('suppress-known-false-positive');
      expect(result.data.actions).toHaveLength(1);
    }
  });

  it('rejects a rule without id', () => {
    const result = RuleSchema.safeParse({
      condition: {},
      actions: [{ type: 'suppress' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a rule without actions', () => {
    const result = RuleSchema.safeParse({
      id: 'no-actions',
      condition: {},
      actions: [],
    });
    expect(result.success).toBe(false);
  });

  it('validates a rule with multiple actions (Route + Escalate)', () => {
    const rule = {
      id: 'route-and-escalate',
      name: 'Route and Escalate Payments',
      condition: {
        serviceName: 'payments-api',
        severity: 'critical',
      },
      actions: [
        { type: 'route', channel: 'slack-sre' },
        { type: 'escalate', channel: 'pagerduty-critical' },
      ],
    };
    const result = RuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actions).toHaveLength(2);
    }
  });
});

describe('RuleSectionSchema', () => {
  it('validates a section with rules array', () => {
    const section = {
      rules: [
        {
          id: 'r1',
          name: 'Rule One',
          condition: { serviceName: 'test' },
          actions: [{ type: 'suppress' }],
        },
        {
          id: 'r2',
          name: 'Rule Two',
          condition: { severity: 'high' },
          actions: [{ type: 'tag', key: 'priority', value: 'p1' }],
        },
      ],
    };
    const result = RuleSectionSchema.safeParse(section);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rules).toHaveLength(2);
    }
  });

  it('validates an empty rules array', () => {
    const result = RuleSectionSchema.safeParse({ rules: [] });
    expect(result.success).toBe(true);
  });
});

describe('RuleConfigurationSchema — full YAML shape', () => {
  it('validates a complete configuration with pre-llm and post-llm sections', () => {
    const config: RuleConfiguration = {
      'pre-llm': {
        rules: [
          {
            id: 'suppress-legacy',
            name: 'Suppress Legacy API',
            condition: {
              serviceName: 'legacy-api',
              alertType: AlertType.Error,
            },
            actions: [{ type: 'suppress' }],
          },
          {
            id: 'route-payments',
            name: 'Route Payments to SRE',
            condition: {
              serviceName: 'payments-api',
              severity: 'critical',
              alertCount: { min: 5 },
            },
            actions: [
              { type: 'route', channel: 'slack-sre' },
              { type: 'escalate', channel: 'pagerduty-critical' },
            ],
          },
        ],
      },
      'post-llm': {
        rules: [
          {
            id: 'escalate-rollback',
            name: 'Escalate Critical Rollbacks',
            condition: {
              urgencyLevel: 'critical',
              requiresRollback: true,
            },
            actions: [
              { type: 'escalate', channel: 'pagerduty-critical' },
              { type: 'tag', key: 'incident-class', value: 'rollback-required' },
            ],
          },
        ],
      },
    };
    const result = RuleConfigurationSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data['pre-llm'].rules).toHaveLength(2);
      expect(result.data['post-llm'].rules).toHaveLength(1);
    }
  });

  it('validates configuration with empty sections', () => {
    const config = {
      'pre-llm': { rules: [] },
      'post-llm': { rules: [] },
    };
    const result = RuleConfigurationSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects configuration missing pre-llm section', () => {
    const result = RuleConfigurationSchema.safeParse({
      'post-llm': { rules: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects configuration missing post-llm section', () => {
    const result = RuleConfigurationSchema.safeParse({
      'pre-llm': { rules: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid action type deep in the config', () => {
    const config = {
      'pre-llm': {
        rules: [
          {
            id: 'bad-rule',
            name: 'Bad Rule',
            condition: {},
            actions: [{ type: 'banana' }],
          },
        ],
      },
      'post-llm': { rules: [] },
    };
    const result = RuleConfigurationSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
