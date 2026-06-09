import { describe, it, expect, vi } from 'vitest';
import type { AlertCluster } from '../../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';
import type { INotifier } from '../../../domain/ports/index.js';
import type { RuleAction } from '../../../domain/entities/rule.js';
import { RuleActionType } from '../../../domain/entities/rule.js';
import { ChannelRegistry } from '../../rules/channel-registry.js';
import { RoutingNotifier } from '../routing-notifier.js';

// ─────────────────────────────────────────────────────────────────────────────
// TDD: RED phase — tests written FIRST. routing-notifier.ts does NOT exist yet.
// ─────────────────────────────────────────────────────────────────────────────

const baseCluster: AlertCluster = {
  fingerprint: 'abc123',
  serviceName: 'test-svc',
  alertType: 'http_500' as AlertCluster['alertType'],
  endpointPath: '/api',
  alertCount: 5,
  representativeTraceIds: ['t1'],
  firstSeenAt: '2026-06-09T12:00:00.000Z',
};

const baseAnalysis: LLMAnalysis = {
  probable_cause: 'test cause',
  impacted_services: ['test-svc'],
  recommended_steps: ['step 1'],
  urgency_level: 'high',
  requires_rollback: false,
};

function makeNotifier(_name: string): INotifier {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

describe('RoutingNotifier', () => {
  // ── Default send ──────────────────────────────────────────────────────────

  it('sends via default notifier when no actions provided', async () => {
    const defaultNotifier = makeNotifier('default');
    const registry = new ChannelRegistry();
    const router = new RoutingNotifier(registry, defaultNotifier);

    await router.send(baseCluster, baseAnalysis);

    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
  });

  it('sends via default notifier with null analysis', async () => {
    const defaultNotifier = makeNotifier('default');
    const registry = new ChannelRegistry();
    const router = new RoutingNotifier(registry, defaultNotifier);

    await router.send(baseCluster, null);

    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, null);
  });

  // ── sendWithActions: Route ────────────────────────────────────────────────

  it('routes to specified channel for Route action', async () => {
    const defaultNotifier = makeNotifier('default');
    const slackNotifier = makeNotifier('slack');
    const registry = new ChannelRegistry();
    registry.register('slack-sre', slackNotifier);

    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Route, channel: 'slack-sre' },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    expect(slackNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
    // Default notifier should NOT be called when a Route action is present
    expect(defaultNotifier.send).not.toHaveBeenCalled();
  });

  // ── sendWithActions: Escalate ─────────────────────────────────────────────

  it('sends escalation to specified channel AND default notifier', async () => {
    const defaultNotifier = makeNotifier('default');
    const pagerdutyNotifier = makeNotifier('pagerduty');
    const registry = new ChannelRegistry();
    registry.register('pagerduty-critical', pagerdutyNotifier);

    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    // Default notifier still sends (escalate is additional, not replacement)
    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
    // Escalation channel also receives notification
    expect(pagerdutyNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
  });

  // ── sendWithActions: Suppress ─────────────────────────────────────────────

  it('does NOT send anything for Suppress action (handled by caller)', async () => {
    const defaultNotifier = makeNotifier('default');
    const registry = new ChannelRegistry();
    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Suppress },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    expect(defaultNotifier.send).not.toHaveBeenCalled();
  });

  // ── sendWithActions: Tag ──────────────────────────────────────────────────

  it('Tag-only actions fall back to default notifier (Tag is metadata, not routing)', async () => {
    const defaultNotifier = makeNotifier('default');
    const registry = new ChannelRegistry();
    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Tag, key: 'team', value: 'sre' },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    // Tag actions are metadata-only — they do NOT affect routing.
    // With no Route/Escalate actions, the default notifier still fires.
    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
  });

  // ── Fallback: unknown channel ─────────────────────────────────────────────

  it('falls back to default notifier when channel is unknown', async () => {
    const defaultNotifier = makeNotifier('default');
    const registry = new ChannelRegistry();

    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Route, channel: 'nonexistent' },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
  });

  // ── Multiple actions ──────────────────────────────────────────────────────

  it('dispatches multiple actions to all channels', async () => {
    const defaultNotifier = makeNotifier('default');
    const slackNotifier = makeNotifier('slack');
    const pagerdutyNotifier = makeNotifier('pagerduty');
    const registry = new ChannelRegistry();
    registry.register('slack-sre', slackNotifier);
    registry.register('pagerduty-critical', pagerdutyNotifier);

    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Route, channel: 'slack-sre' },
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    // Route: slack-sre gets called instead of default
    expect(slackNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
    // Escalate: pagerduty-critical gets called in addition
    expect(pagerdutyNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
    // Default notifier NOT called because Route overrides default
    expect(defaultNotifier.send).not.toHaveBeenCalled();
  });

  // ── Empty actions ─────────────────────────────────────────────────────────

  it('falls back to default notifier when actions array is empty', async () => {
    const defaultNotifier = makeNotifier('default');
    const registry = new ChannelRegistry();
    const router = new RoutingNotifier(registry, defaultNotifier);

    await router.sendWithActions(baseCluster, baseAnalysis, []);

    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
  });

  // ── Escalate-only with no Route: default still sends ─────────────────────

  it('sends via default notifier when only Escalate action present', async () => {
    const defaultNotifier = makeNotifier('default');
    const pagerdutyNotifier = makeNotifier('pagerduty');
    const registry = new ChannelRegistry();
    registry.register('pagerduty-critical', pagerdutyNotifier);

    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
    expect(pagerdutyNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
  });

  // ── Tag + Escalate: only Escalate triggers notification ──────────────────

  it('Tag action does not affect routing — only Route/Escalate trigger notifications', async () => {
    const defaultNotifier = makeNotifier('default');
    const pagerdutyNotifier = makeNotifier('pagerduty');
    const registry = new ChannelRegistry();
    registry.register('pagerduty-critical', pagerdutyNotifier);

    const router = new RoutingNotifier(registry, defaultNotifier);

    const actions: RuleAction[] = [
      { type: RuleActionType.Tag, key: 'severity', value: 'critical' },
      { type: RuleActionType.Escalate, channel: 'pagerduty-critical' },
    ];

    await router.sendWithActions(baseCluster, baseAnalysis, actions);

    // Default sends (no Route to override)
    expect(defaultNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
    // Escalate sends to pagerduty
    expect(pagerdutyNotifier.send).toHaveBeenCalledWith(baseCluster, baseAnalysis);
  });
});
