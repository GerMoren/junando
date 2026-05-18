import type { Config } from '../../shared/config/index.js';
import type { INotifier } from '../../domain/ports/index.js';
import { SlackNotifier } from './slack.adapter.js';
import { TeamsNotifier } from './teams.adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// createNotifier — single instantiation point for all notifier types.
// Satisfies WIR-02: branching logic MUST NOT be scattered across modules.
// ─────────────────────────────────────────────────────────────────────────────

export function createNotifier(config: Config): INotifier {
  switch (config.notifierType) {
    case 'teams':
      return new TeamsNotifier(config.teamsWebhookUrl!);
    case 'slack':
    default:
      return new SlackNotifier(config.slackBotToken!, config.slackChannel!);
  }
}
