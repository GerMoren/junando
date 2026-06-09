import { FactoryRegistry } from '../../shared/factory-registry.js';
import type { Config } from '../../shared/config/index.js';
import type { INotifier } from '../../domain/ports/index.js';
import { SlackNotifier } from './slack.adapter.js';
import { TeamsNotifier } from './teams.adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// createNotifier — single instantiation point, no switch/case.
// Registry holds factories, resolve picks the right one.
// ─────────────────────────────────────────────────────────────────────────────

function buildNotifierRegistry(config: Config): FactoryRegistry<INotifier> {
  const registry = new FactoryRegistry<INotifier>();

  registry.register('teams', () => {
    if (!config.teamsWebhookUrl) {
      throw new Error('NOTIFIER_TYPE=teams requires TEAMS_WEBHOOK_URL to be set');
    }
    return new TeamsNotifier(config.teamsWebhookUrl);
  });

  registry.register('slack', () => {
    if (!config.slackBotToken || !config.slackChannel) {
      throw new Error('NOTIFIER_TYPE=slack requires SLACK_BOT_TOKEN and SLACK_CHANNEL to be set');
    }
    return new SlackNotifier(config.slackBotToken, config.slackChannel);
  });

  // Default: Slack (matches prior switch behavior where default was Slack)
  registry.registerDefault(() => new SlackNotifier('dummy-token', '#alerts'));

  return registry;
}

export function createNotifier(config: Config): INotifier {
  const registry = buildNotifierRegistry(config);
  return registry.resolve(config.notifierType);
}
