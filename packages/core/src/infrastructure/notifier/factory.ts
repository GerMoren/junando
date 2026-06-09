import { readFileSync } from 'node:fs';
import { FactoryRegistry } from '../../shared/factory-registry.js';
import type { Config } from '../../shared/config/index.js';
import type { INotifier } from '../../domain/ports/index.js';
import type { IRuleEngine } from '../../domain/ports/index.js';
import { SlackNotifier } from './slack.adapter.js';
import { TeamsNotifier } from './teams.adapter.js';
import { RoutingNotifier } from './routing-notifier.js';
import { parseRuleConfig } from '../rules/yaml-rule-loader.js';
import { ChannelRegistry } from '../rules/channel-registry.js';
import { RuleEngine } from '../rules/rule-engine.js';

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

/**
 * Creates the notifier for the application.
 *
 * When `config.rulesConfigPath` is set:
 *   - Reads and validates the rules YAML config
 *   - Creates a ChannelRegistry with the default notifier as fallback
 *   - Wraps the default notifier with a RoutingNotifier for multi-channel dispatch
 *
 * When `config.rulesConfigPath` is NOT set:
 *   - Returns the default notifier directly (backward-compatible)
 */
export function createNotifier(config: Config): INotifier {
  const registry = buildNotifierRegistry(config);
  const defaultNotifier = registry.resolve(config.notifierType);

  if (!config.rulesConfigPath) {
    return defaultNotifier;
  }

  // Read and parse rules YAML
  const yamlContent = readFileSync(config.rulesConfigPath, 'utf-8');
  parseRuleConfig(yamlContent); // Validate — throws on invalid config

  // Create channel registry with default notifier as fallback
  const channelRegistry = new ChannelRegistry();
  channelRegistry.setDefault(defaultNotifier);

  // Wrap with routing notifier for multi-channel dispatch
  return new RoutingNotifier(channelRegistry, defaultNotifier);
}

/**
 * Creates the RuleEngine from a YAML rules config file.
 *
 * Returns undefined when `config.rulesConfigPath` is not set,
 * meaning rule evaluation is disabled (pass-through behavior).
 */
export function createRuleEngine(config: Config): IRuleEngine | undefined {
  if (!config.rulesConfigPath) {
    return undefined;
  }

  const yamlContent = readFileSync(config.rulesConfigPath, 'utf-8');
  const ruleConfig = parseRuleConfig(yamlContent);
  return new RuleEngine(ruleConfig);
}
