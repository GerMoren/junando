import { describe, it, expect, beforeEach } from 'vitest';
import { suppressedClusters, registry } from '../index.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED → GREEN — suppressedClusters Gauge metric
// ─────────────────────────────────────────────────────────────────────────────

describe('suppressedClusters metric', () => {
  beforeEach(async () => {
    // Reset metric state between tests
    await registry.resetMetrics();
  });

  it('is defined and is a Gauge', () => {
    expect(suppressedClusters).toBeDefined();
    expect(typeof suppressedClusters.inc).toBe('function');
    expect(typeof suppressedClusters.set).toBe('function');
  });

  it('has "rule_id" in labelNames for per-rule tracking', () => {
    expect(suppressedClusters.labelNames).toContain('rule_id');
  });

  it('inc() without labels increments the default counter', async () => {
    suppressedClusters.inc();
    const json = await registry.getMetricsAsJSON();
    const metric = json.find((m) => m.name === 'junando_suppressed_clusters');
    expect(metric).toBeDefined();
    const totalValue = metric!.values.reduce((sum, v) => sum + v.value, 0);
    expect(totalValue).toBeGreaterThanOrEqual(1);
  });

  it('inc() with rule_id label increments a labeled counter', async () => {
    suppressedClusters.inc({ rule_id: 'suppress-legacy' });
    suppressedClusters.inc({ rule_id: 'suppress-legacy' });

    const json = await registry.getMetricsAsJSON();
    const metric = json.find((m) => m.name === 'junando_suppressed_clusters');
    expect(metric).toBeDefined();
    const matching = metric!.values.find((v) => v.labels.rule_id === 'suppress-legacy');
    expect(matching).toBeDefined();
    expect(matching!.value).toBe(2);
  });

  it('set() directly sets the metric value', async () => {
    suppressedClusters.set(5);

    const json = await registry.getMetricsAsJSON();
    const metric = json.find((m) => m.name === 'junando_suppressed_clusters');
    expect(metric).toBeDefined();
    const totalValue = metric!.values.reduce((sum, v) => sum + v.value, 0);
    expect(totalValue).toBe(5);
  });

  it('different rule_ids track independently', async () => {
    suppressedClusters.inc({ rule_id: 'rule-a' });
    suppressedClusters.inc({ rule_id: 'rule-a' });
    suppressedClusters.inc({ rule_id: 'rule-b' });

    const json = await registry.getMetricsAsJSON();
    const metric = json.find((m) => m.name === 'junando_suppressed_clusters');
    expect(metric).toBeDefined();
    const ruleA = metric!.values.find((v) => v.labels.rule_id === 'rule-a');
    const ruleB = metric!.values.find((v) => v.labels.rule_id === 'rule-b');

    expect(ruleA?.value).toBe(2);
    expect(ruleB?.value).toBe(1);
  });
});
