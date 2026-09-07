import { readFileSync } from 'node:fs';
import { FactoryRegistry } from '../../shared/factory-registry.js';
import { createLogger } from '../../shared/logger/index.js';
import type { Config } from '../../shared/config/index.js';
import type { INotifier } from '../../domain/ports/index.js';
import type { IRuleEngine } from '../../domain/ports/index.js';
import { ChannelType } from '../../domain/entities/rule.js';
import type { ChannelConfig } from '../../domain/entities/rule.js';
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

const logger = createLogger();

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
 * Builds the notifier for a single named channel entry from the rules YAML's
 * `channels:` section.
 *
 * @throws {Error} if the channel's backend cannot actually be reached (e.g.
 *   `type: slack` with no SLACK_BOT_TOKEN configured, or `type: teams` whose
 *   `webhookUrlEnv` is unset) — fails fast at startup rather than at delivery
 *   time, mid-incident.
 */
function buildChannelNotifier(name: string, channelConfig: ChannelConfig, config: Config): INotifier {
  if (channelConfig.type === ChannelType.Slack) {
    if (!config.slackBotToken) {
      throw new Error(
        `Channel "${name}" (type: slack) requires SLACK_BOT_TOKEN to be set`,
      );
    }
    return new SlackNotifier(config.slackBotToken, channelConfig.channel);
  }

  const webhookUrl = process.env[channelConfig.webhookUrlEnv];
  if (!webhookUrl) {
    throw new Error(
      `Channel "${name}" (type: teams) references env var "${channelConfig.webhookUrlEnv}", which is not set`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new Error(`Channel "${name}": ${channelConfig.webhookUrlEnv} is not a valid URL`);
  }
  if (!parsedUrl.searchParams.has('api-version')) {
    throw new Error(
      `Channel "${name}": ${channelConfig.webhookUrlEnv} must include api-version= as a query parameter`,
    );
  }

  return new TeamsNotifier(webhookUrl);
}

/**
 * Creates the notifier for the application.
 *
 * When `config.rulesConfigPath` is set:
 *   - Reads and validates the rules YAML config
 *   - Builds a ChannelRegistry from its `channels:` section, with the default
 *     notifier as fallback
 *   - Wraps the default notifier with a RoutingNotifier for multi-channel dispatch
 *
 * When `config.rulesConfigPath` is NOT set:
 *   - Returns the default notifier directly (backward-compatible)
 *
 * @throws {Error} at startup if a rule's route/escalate action references a
 *   channel with no matching entry under `channels:` — an operator must fix
 *   the rules config rather than have the alert silently fall back to the
 *   default channel mid-incident.
 */
export function createNotifier(config: Config): INotifier {
  const registry = buildNotifierRegistry(config);
  const defaultNotifier = registry.resolve(config.notifierType);

  if (!config.rulesConfigPath) {
    logger.debug('RULES_CONFIG_PATH not set — rule engine disabled, using default notifier');
    return defaultNotifier;
  }

  const yamlContent = readFileSync(config.rulesConfigPath, 'utf-8');
  const ruleConfig = parseRuleConfig(yamlContent);

  // Create channel registry with default notifier as fallback, then populate
  // it from the rules YAML's `channels:` section.
  const channelRegistry = new ChannelRegistry();
  channelRegistry.setDefault(defaultNotifier);
  for (const [name, channelConfig] of Object.entries(ruleConfig.channels)) {
    channelRegistry.register(name, buildChannelNotifier(name, channelConfig, config));
  }

  const unresolved = collectUnresolvedChannels(config, channelRegistry);
  if (unresolved.length > 0) {
    throw new Error(
      `Rules reference undefined channels: ${unresolved.join(', ')}. Define them under ` +
        `"channels:" in ${config.rulesConfigPath}, or remove the reference.`,
    );
  }

  // Wrap with routing notifier for multi-channel dispatch
  return new RoutingNotifier(channelRegistry, defaultNotifier);
}

/**
 * Collect the channel names referenced by Route/Escalate actions in the rules
 * config that have no notifier registered against `registry` — i.e. no
 * matching entry under the rules YAML's `channels:` section. `createNotifier`
 * treats a non-empty result as a fail-fast startup error.
 *
 * Returns an empty list when no rules config is set.
 */
export function collectUnresolvedChannels(
  config: Config,
  registry?: ChannelRegistry,
): string[] {
  if (!config.rulesConfigPath) {
    return [];
  }

  const yamlContent = readFileSync(config.rulesConfigPath, 'utf-8');
  const ruleConfig = parseRuleConfig(yamlContent); // Throws on invalid config

  const referenced = new Set<string>();
  for (const section of [ruleConfig['pre-llm'], ruleConfig['post-llm']]) {
    for (const rule of section.rules) {
      for (const action of rule.actions) {
        if ('channel' in action) {
          referenced.add(action.channel);
        }
      }
    }
  }

  return [...referenced].filter((channel) => !registry?.has(channel));
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
