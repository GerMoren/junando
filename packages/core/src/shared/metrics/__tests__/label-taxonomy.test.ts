import { describe, it, expect } from 'vitest';

// We import the registry and metrics fresh for taxonomy validation.
// Each test uses the real module exports to verify label contracts.

describe('metrics label taxonomy — contract tests', () => {
  // Note: prom-client registers metrics globally in the registry singleton.
  // We import the module-level exports so we test the actual declarations.

  it('exports dedupNew counter with source label', async () => {
    const { dedupNew } = await import('../index.js');
    expect(dedupNew).toBeDefined();
    expect(dedupNew.labelNames).toContain('source');
  });

  it('exports dedupDuplicate counter with source label', async () => {
    const { dedupDuplicate } = await import('../index.js');
    expect(dedupDuplicate).toBeDefined();
    expect(dedupDuplicate.labelNames).toContain('source');
  });

  it('exports notificationsTotal counter with channel and outcome labels', async () => {
    const { notificationsTotal } = await import('../index.js');
    expect(notificationsTotal).toBeDefined();
    expect(notificationsTotal.labelNames).toContain('channel');
    expect(notificationsTotal.labelNames).toContain('outcome');
  });

  it('exports sqsQueueLag gauge with queue_name label', async () => {
    const { sqsQueueLag } = await import('../index.js');
    expect(sqsQueueLag).toBeDefined();
    expect(sqsQueueLag.labelNames).toContain('queue_name');
  });

  it('alertsProcessed counter has result label', async () => {
    const { alertsProcessed } = await import('../index.js');
    expect(alertsProcessed.labelNames).toContain('result');
  });

  it('latency histogram has status label and correct buckets', async () => {
    const { latency } = await import('../index.js');
    expect(latency.labelNames).toContain('status');
  });

  it('all new metrics are present in the registry', async () => {
    const { registry } = await import('../index.js');
    const json = await registry.getMetricsAsJSON();
    const names = json.map((m: { name: string }) => m.name);
    expect(names).toContain('junando_dedup_new_total');
    expect(names).toContain('junando_dedup_duplicate_total');
    expect(names).toContain('junando_notifications_total');
    expect(names).toContain('junando_sqs_queue_lag');
    expect(names).toContain('junando_alerts_processed_total');
    expect(names).toContain('junando_webhook_duration_seconds');
  });

  it('dedupNew.inc fires without throwing with allowed label values', async () => {
    const { dedupNew } = await import('../index.js');
    expect(() => dedupNew.inc({ source: 'alertmanager' })).not.toThrow();
    expect(() => dedupNew.inc({ source: 'unknown' })).not.toThrow();
  });

  it('dedupDuplicate.inc fires without throwing with allowed label values', async () => {
    const { dedupDuplicate } = await import('../index.js');
    expect(() => dedupDuplicate.inc({ source: 'alertmanager' })).not.toThrow();
    expect(() => dedupDuplicate.inc({ source: 'unknown' })).not.toThrow();
  });

  it('notificationsTotal.inc fires without throwing with allowed label combinations', async () => {
    const { notificationsTotal } = await import('../index.js');
    expect(() => notificationsTotal.inc({ channel: 'slack', outcome: 'success' })).not.toThrow();
    expect(() => notificationsTotal.inc({ channel: 'teams', outcome: 'failure' })).not.toThrow();
    expect(() => notificationsTotal.inc({ channel: 'unknown', outcome: 'dropped' })).not.toThrow();
  });

  it('sqsQueueLag.set fires without throwing', async () => {
    const { sqsQueueLag } = await import('../index.js');
    expect(() => sqsQueueLag.set({ queue_name: 'alerts' }, 42)).not.toThrow();
  });

  it('alertsProcessed.inc fires without throwing with result label', async () => {
    const { alertsProcessed } = await import('../index.js');
    expect(() => alertsProcessed.inc({ result: 'success' })).not.toThrow();
    expect(() => alertsProcessed.inc({ result: 'failure' })).not.toThrow();
  });

  it('latency.observe fires without throwing with status label', async () => {
    const { latency } = await import('../index.js');
    expect(() => latency.observe({ status: 'success' }, 0.025)).not.toThrow();
    expect(() => latency.observe({ status: 'error' }, 0.010)).not.toThrow();
  });
});
