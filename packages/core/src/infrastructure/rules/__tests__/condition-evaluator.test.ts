import { describe, it, expect } from 'vitest';
import { AlertType } from '../../../shared/constants.js';
import { SeverityLevel } from '../../../domain/entities/rule.js';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';
import type { RuleCondition } from '../../../domain/entities/rule.js';

// Import the function under test — does NOT exist yet (RED)
import { compileCondition } from '../condition-evaluator.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST. condition-evaluator.ts does NOT exist yet.
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
  probable_cause: 'Database connection pool exhaustion',
  impacted_services: ['payments-api', 'inventory-api'],
  recommended_steps: ['Scale up DB connections', 'Check connection leaks'],
  urgency_level: 'critical',
  requires_rollback: true,
};

// ─────────────────────────────────────────────────────────────────────
// PRE-LLM conditions (no analysis)
// ─────────────────────────────────────────────────────────────────────

describe('compileCondition — PRE-LLM (cluster only)', () => {
  it('matches exact serviceName (case-insensitive)', () => {
    const condition: RuleCondition = { serviceName: 'Payments-API' };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('does NOT match different serviceName', () => {
    const condition: RuleCondition = { serviceName: 'other-service' };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('matches exact alertType', () => {
    const condition: RuleCondition = { alertType: AlertType.Error };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('does NOT match different alertType', () => {
    const condition: RuleCondition = { alertType: AlertType.Warning };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('matches severity derived from alertType', () => {
    // AlertType.Error → severity 'critical' in ALERT_TYPE_LABELS
    const condition: RuleCondition = { severity: SeverityLevel.Critical };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('does NOT match wrong severity for given alertType', () => {
    // AlertType.Error → severity 'critical', not 'low'
    const condition: RuleCondition = { severity: SeverityLevel.Low };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('matches exact endpointPath', () => {
    const condition: RuleCondition = { endpointPath: '/api/payments' };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('does NOT match different endpointPath', () => {
    const condition: RuleCondition = { endpointPath: '/api/other' };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('matches alertCount within range (min and max)', () => {
    const condition: RuleCondition = { alertCount: { min: 10, max: 20 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('matches alertCount at exact boundary (equal to min)', () => {
    const condition: RuleCondition = { alertCount: { min: 15 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('does NOT match alertCount below minimum', () => {
    const condition: RuleCondition = { alertCount: { min: 20 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('does NOT match alertCount above maximum', () => {
    const condition: RuleCondition = { alertCount: { max: 10 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('matches latencyP99Ms within range', () => {
    const condition: RuleCondition = { latencyP99Ms: { min: 200, max: 500 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('does NOT match latencyP99Ms outside range', () => {
    const condition: RuleCondition = { latencyP99Ms: { max: 200 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('matches when ALL conditions are satisfied (AND logic)', () => {
    const condition: RuleCondition = {
      serviceName: 'payments-api',
      alertType: AlertType.Error,
      severity: SeverityLevel.Critical,
      alertCount: { min: 10 },
    };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });

  it('does NOT match when ONE condition fails (AND logic)', () => {
    const condition: RuleCondition = {
      serviceName: 'payments-api',
      alertType: AlertType.Error,
      severity: SeverityLevel.Low, // wrong severity for this alertType
    };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(false);
  });

  it('matches when condition is empty (no fields specified)', () => {
    const condition: RuleCondition = {};
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST-LLM conditions (cluster + analysis)
// ─────────────────────────────────────────────────────────────────────

describe('compileCondition — POST-LLM (cluster + analysis)', () => {
  it('matches urgencyLevel against analysis.urgency_level', () => {
    const condition: RuleCondition = { urgencyLevel: 'critical' };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster, baseAnalysis)).toBe(true);
  });

  it('does NOT match different urgencyLevel', () => {
    const condition: RuleCondition = { urgencyLevel: 'low' };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster, baseAnalysis)).toBe(false);
  });

  it('matches requiresRollback against analysis.requires_rollback', () => {
    const condition: RuleCondition = { requiresRollback: true };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster, baseAnalysis)).toBe(true);
  });

  it('does NOT match when requiresRollback is false but expected true', () => {
    const condition: RuleCondition = { requiresRollback: true };
    const noRollbackAnalysis: LLMAnalysis = { ...baseAnalysis, requires_rollback: false };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster, noRollbackAnalysis)).toBe(false);
  });

  it('matches impactedServices when at least one service matches', () => {
    const condition: RuleCondition = { impactedServices: ['payments-api'] };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster, baseAnalysis)).toBe(true);
  });

  it('does NOT match impactedServices when no services overlap', () => {
    const condition: RuleCondition = { impactedServices: ['unrelated-service'] };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster, baseAnalysis)).toBe(false);
  });

  it('matches combined PRE-LLM + POST-LLM conditions', () => {
    const condition: RuleCondition = {
      serviceName: 'payments-api',
      urgencyLevel: 'critical',
      requiresRollback: true,
    };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster, baseAnalysis)).toBe(true);
  });

  it('fails POST-LLM condition when analysis is missing', () => {
    const condition: RuleCondition = { urgencyLevel: 'critical' };
    const predicate = compileCondition(condition);
    // Without analysis, post-llm conditions cannot be evaluated → should fail
    expect(predicate(baseCluster)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────

describe('compileCondition — edge cases', () => {
  it('handles undefined cluster.latencyP99Ms gracefully', () => {
    const clusterWithoutLatency: AlertCluster = {
      ...baseCluster,
      latencyP99Ms: undefined,
    };
    const condition: RuleCondition = { latencyP99Ms: { min: 100 } };
    const predicate = compileCondition(condition);
    expect(predicate(clusterWithoutLatency)).toBe(false);
  });

  it('handles partial range (only min)', () => {
    const condition: RuleCondition = { alertCount: { min: 10 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true); // 15 >= 10
  });

  it('handles partial range (only max)', () => {
    const condition: RuleCondition = { alertCount: { max: 20 } };
    const predicate = compileCondition(condition);
    expect(predicate(baseCluster)).toBe(true); // 15 <= 20
  });
});
