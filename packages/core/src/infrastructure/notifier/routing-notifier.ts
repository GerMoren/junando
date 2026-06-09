import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import type { INotifier } from '../../domain/ports/index.js';
import type { RuleAction } from '../../domain/entities/rule.js';
import { RuleActionType } from '../../domain/entities/rule.js';
import type { ChannelRegistry } from '../rules/channel-registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// RoutingNotifier — wraps multiple INotifier instances via ChannelRegistry.
// Implements INotifier for default-channel backward compatibility.
//
// No switch/case — uses Record<RuleActionType, handler> pattern for action dispatch.
// Route actions override the default channel.
// Escalate actions send additional notifications alongside default/route.
// Tag actions are metadata-only (no notification side effect).
// Suppress actions are handled by the caller (use case).
// ─────────────────────────────────────────────────────────────────────────────

type ActionDispatchHandler = (
  action: RuleAction,
  ctx: ActionDispatchContext,
) => Promise<void>;

interface ActionDispatchContext {
  cluster: AlertCluster;
  analysis: LLMAnalysis | null;
  registry: ChannelRegistry;
  defaultNotifier: INotifier;
  /** Accumulates channels to notify — populated by Route/Escalate handlers */
  routeChannels: Set<string>;
  escalationChannels: Set<string>;
  /** Set to true if a Suppress action is present — skips all notification */
  suppressed: boolean;
}

/**
 * Dispatch map: RuleActionType → handler function.
 * Record pattern — NO switch/case.
 */
const ACTION_DISPATCH: Record<string, ActionDispatchHandler> = {
  [RuleActionType.Suppress]: async (_action, ctx) => {
    // Suppress actions are handled by the caller (use case).
    // When present in sendWithActions, suppress all notification as a defensive measure.
    ctx.suppressed = true;
  },

  [RuleActionType.Route]: async (action, ctx) => {
    const routeAction = action as { type: RuleActionType.Route; channel: string };
    ctx.routeChannels.add(routeAction.channel);
  },

  [RuleActionType.Escalate]: async (action, ctx) => {
    const escalateAction = action as { type: RuleActionType.Escalate; channel: string };
    ctx.escalationChannels.add(escalateAction.channel);
  },

  [RuleActionType.Tag]: async (_action, _ctx) => {
    // Tag actions are metadata-only. No notification side effect.
    // The caller (use case) attaches tags to the cluster for observability.
  },
};

export class RoutingNotifier implements INotifier {
  constructor(
    private readonly registry: ChannelRegistry,
    private readonly defaultNotifier: INotifier,
  ) {}

  /**
   * Implements INotifier.send — sends via default notifier.
   * Backward-compatible with existing call sites that don't use rule actions.
   */
  async send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void> {
    await this.defaultNotifier.send(cluster, analysis);
  }

  /**
   * Dispatch notifications based on rule engine actions.
   *
   * - Route actions: send to the specified channel instead of default.
   * - Escalate actions: send additional notifications to escalation channels.
   * - Tag actions: metadata-only, no notification side effect.
   * - Suppress actions: skip all notification (defensive — caller should have already skipped).
   * - Unknown channels: fall back to default notifier.
   * - Empty actions or no Route/Escalate: send via default notifier.
   */
  async sendWithActions(
    cluster: AlertCluster,
    analysis: LLMAnalysis | null,
    actions: RuleAction[],
  ): Promise<void> {
    const ctx: ActionDispatchContext = {
      cluster,
      analysis,
      registry: this.registry,
      defaultNotifier: this.defaultNotifier,
      routeChannels: new Set(),
      escalationChannels: new Set(),
      suppressed: false,
    };

    // Dispatch all actions using Record pattern — NO switch/case
    for (const action of actions) {
      const handler = ACTION_DISPATCH[action.type];
      if (handler) {
        await handler(action, ctx);
      }
    }

    // If suppressed, skip all notification
    if (ctx.suppressed) {
      return;
    }

    // Resolve notifications to send
    const notifications: Promise<void>[] = [];

    const hasRoute = ctx.routeChannels.size > 0;

    if (hasRoute) {
      // Route overrides default — send to route channels
      for (const channel of ctx.routeChannels) {
        notifications.push(this.tryResolveAndSend(channel, cluster, analysis));
      }
    } else {
      // No route action — send via default notifier
      notifications.push(this.defaultNotifier.send(cluster, analysis));
    }

    // Escalation channels send in addition to default/route
    for (const channel of ctx.escalationChannels) {
      notifications.push(this.tryResolveAndSend(channel, cluster, analysis));
    }

    await Promise.all(notifications);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Resolve a channel name to its notifier and send.
   * Falls back to default notifier if channel is unknown.
   */
  private async tryResolveAndSend(
    channel: string,
    cluster: AlertCluster,
    analysis: LLMAnalysis | null,
  ): Promise<void> {
    try {
      const notifier = this.registry.resolve(channel);
      await notifier.send(cluster, analysis);
    } catch {
      // ChannelRegistry.resolve throws if channel unknown and no default set.
      // Fall back to default notifier.
      await this.defaultNotifier.send(cluster, analysis);
    }
  }
}
