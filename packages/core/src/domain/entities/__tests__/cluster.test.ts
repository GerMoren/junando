import { describe, it, expect } from 'vitest';
import { AlertClusterSchema } from '../cluster.js';
import { AlertType } from '../../../shared/constants.js';
import { SeverityLevel } from '../rule.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST.
// AlertCluster needs severity? and labels? fields.
// ─────────────────────────────────────────────────────────────────────────────

const baseCluster = {
  fingerprint: 'abc123',
  serviceName: 'test-svc',
  alertType: AlertType.Error,
  endpointPath: '/api',
  alertCount: 5,
  representativeTraceIds: ['t1'],
  firstSeenAt: '2026-06-09T12:00:00.000Z',
};

describe('AlertCluster entity — extended fields', () => {
  it('accepts optional severity field', () => {
    const result = AlertClusterSchema.safeParse({
      ...baseCluster,
      severity: SeverityLevel.Critical,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.severity).toBe(SeverityLevel.Critical);
    }
  });

  it('accepts severity = undefined (optional)', () => {
    const result = AlertClusterSchema.safeParse(baseCluster);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.severity).toBeUndefined();
    }
  });

  it('accepts optional labels field', () => {
    const result = AlertClusterSchema.safeParse({
      ...baseCluster,
      labels: { environment: 'staging', team: 'sre' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labels).toEqual({ environment: 'staging', team: 'sre' });
    }
  });

  it('accepts labels = undefined (optional)', () => {
    const result = AlertClusterSchema.safeParse(baseCluster);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labels).toBeUndefined();
    }
  });

  it('accepts both severity and labels together', () => {
    const result = AlertClusterSchema.safeParse({
      ...baseCluster,
      severity: SeverityLevel.High,
      labels: { env: 'prod' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.severity).toBe(SeverityLevel.High);
      expect(result.data.labels).toEqual({ env: 'prod' });
    }
  });

  it('rejects invalid severity value outside enum', () => {
    const result = AlertClusterSchema.safeParse({
      ...baseCluster,
      severity: 'nuclear',
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty labels record', () => {
    const result = AlertClusterSchema.safeParse({
      ...baseCluster,
      labels: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labels).toEqual({});
    }
  });
});
