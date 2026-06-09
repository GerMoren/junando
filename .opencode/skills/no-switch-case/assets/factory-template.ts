import type { Config } from '../../shared/config/index.js';
import { FactoryRegistry } from '../../shared/factory-registry.js';
import type { INotifier } from '../../domain/ports/index.js';
import { TeamsNotifier } from '../notifier/teams.adapter.js';
import { SlackNotifier } from '../notifier/slack.adapter.js';
import { ConsoleNotifier } from '../notifier/slack.adapter.js'; // fallback for dev/tests

// ─────────────────────────────────────────────────────────────────────────────
// Factory Constants — use as registration keys
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFIER_FACTORIES = {
  Teams: 'NotifierFactory:Teams',
  Slack: 'NotifierFactory:Slack',
  Console: 'NotifierFactory:Console',
} as const;

export type NotifierFactoryKey = (typeof NOTIFIER_FACTORIES)[keyof typeof NOTIFIER_FACTORIES];

// ─────────────────────────────────────────────────────────────────────────────
// Factory Registry — no switch/case in resolve
// ─────────────────────────────────────────────────────────────────────────────

function buildNotifierRegistry(config: Config): FactoryRegistry<INotifier> {
  const registry = new FactoryRegistry<INotifier>();

  registry.register(NOTIFIER_FACTORIES.Teams, () => {
    if (!config.teamsWebhookUrl) {
      throw new Error('NOTIFIER_TYPE=teams requires TEAMS_WEBHOOK_URL');
    }
    return new TeamsNotifier(config.teamsWebhookUrl);
  });

  registry.register(NOTIFIER_FACTORIES.Slack, () => {
    if (!config.slackBotToken || !config.slackChannel) {
      throw new Error('NOTIFIER_TYPE=slack requires SLACK_BOT_TOKEN and SLACK_CHANNEL');
    }
    return new SlackNotifier(config.slackBotToken, config.slackChannel);
  });

  registry.registerDefault(() => new ConsoleNotifier());

  return registry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported factory function — single resolution point, no branching
// ─────────────────────────────────────────────────────────────────────────────

let _registry: FactoryRegistry<INotifier> | undefined;

function getRegistry(config: Config): FactoryRegistry<INotifier> {
  if (!_registry) {
    _registry = buildNotifierRegistry(config);
  }
  return _registry;
}

/**
 * Resolve the appropriate INotifier based on config.notifierType.
 * Delegates entirely to the registry — no switch/case here.
 */
export function createNotifier(config: Config): INotifier {
  return getRegistry(config).resolve(config.notifierType);
}

// ─────────────────────────────────────────────────────────────────────────────
// For testing — allow registry reset
// ─────────────────────────────────────────────────────────────────────────────

export function resetNotifierRegistry(): void {
  _registry = undefined;
}