import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import type { INotifier, NotifyResult } from '../../domain/ports/index.js';
import { NotifyOutcome } from '../../domain/ports/index.js';
import { HTTP_TIMEOUT_MS, SLACK_API_URL, URGENCY_EMOJI } from '../../shared/constants.js';
import { createLogger } from '../../shared/logger/index.js';
import { notificationsTotal } from '../../shared/metrics/index.js';

const logger = createLogger();

/**
 * Sanitizes endpointPath for safe rendering in Slack Block Kit.
 * Strips backticks (prevent markup injection) and limits length.
 */
function sanitizeEndpointPath(endpointPath: string | undefined): string {
  if (!endpointPath) return 'unknown';
  return endpointPath.replaceAll('`', '').slice(0, 200);
}

// ─────────────────────────────────────────────────────────────────────────────
// SlackNotifier — Infrastructure adapter.
// Implements INotifier using Slack Block Kit.
// Swap for TeamsNotifier without touching application or domain code.
// ─────────────────────────────────────────────────────────────────────────────

export class SlackNotifier implements INotifier {
  constructor(
    private readonly botToken: string,
    private readonly channel: string,
  ) {}

  async send(cluster: AlertCluster, analysis: LLMAnalysis | null, _channel?: string): Promise<NotifyResult> {
    const payload = analysis
      ? this.buildAnalysisMessage(cluster, analysis)
      : this.buildFallbackMessage(cluster);

    const startMs = Date.now();

    try {
      const res = await fetch(SLACK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({ channel: this.channel, ...payload }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.Default),
      });

      if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(`Slack error: ${body.error}`);

      notificationsTotal.inc({ channel: 'slack', outcome: 'success' });
      // Report the channel actually posted to — the override is handled one
      // level up by RoutingNotifier, so this adapter always targets this.channel.
      return {
        outcome: NotifyOutcome.Success,
        latencyMs: Date.now() - startMs,
        channels: [this.channel],
      };
    } catch (err) {
      notificationsTotal.inc({ channel: 'slack', outcome: 'failure' });
      throw err;
    }
  }

  private buildAnalysisMessage(
    cluster: AlertCluster,
    analysis: LLMAnalysis,
  ): { blocks: unknown[] } {
    const emoji = URGENCY_EMOJI[analysis.urgency_level] ?? '⚪';
    const steps = analysis.recommended_steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

    const safeEndpointPath = sanitizeEndpointPath(cluster.endpointPath);

    return {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} Incident — ${cluster.serviceName}`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Service*\n${cluster.serviceName}` },
            { type: 'mrkdwn', text: `*Alerts*\n${cluster.alertCount}` },
            { type: 'mrkdwn', text: `*Endpoint*\n${safeEndpointPath}` },
            {
              type: 'mrkdwn',
              text: `*Urgency*\n${emoji} ${analysis.urgency_level.toUpperCase()}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Probable cause*\n${analysis.probable_cause}`,
          },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Recommended steps*\n${steps}` },
        },
        { type: 'divider' },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Acknowledge' },
              style: 'primary',
              action_id: 'acknowledge',
              value: cluster.fingerprint,
            },
            ...(analysis.requires_rollback
              ? [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '⏪ Trigger Rollback' },
                    style: 'danger',
                    action_id: 'trigger_rollback',
                    value: cluster.fingerprint,
                    confirm: {
                      title: { type: 'plain_text', text: 'Confirm rollback' },
                      text: {
                        type: 'plain_text',
                        text: `Roll back ${cluster.serviceName}?`,
                      },
                      confirm: { type: 'plain_text', text: 'Yes, rollback' },
                      deny: { type: 'plain_text', text: 'Cancel' },
                    },
                  },
                ]
              : []),
          ],
        },
      ],
    };
  }

  private buildFallbackMessage(cluster: AlertCluster): { blocks: unknown[] } {
    const safeEndpointPath = sanitizeEndpointPath(cluster.endpointPath);

    return {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `⚠️ Incident — ${cluster.serviceName} (no AI diagnosis)`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${cluster.alertCount} alerts* on \`${safeEndpointPath}\` since ${cluster.firstSeenAt}\nLLM analysis unavailable — manual investigation required.`,
          },
        },
      ],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ConsoleNotifier — Local dev / test adapter. Prints to stdout.
// ─────────────────────────────────────────────────────────────────────────────

export class ConsoleNotifier implements INotifier {
  readonly sent: Array<{
    cluster: AlertCluster;
    analysis: LLMAnalysis | null;
  }> = [];

  async send(cluster: AlertCluster, analysis: LLMAnalysis | null, _channel?: string): Promise<NotifyResult> {
    const startMs = Date.now();
    try {
      this.sent.push({ cluster, analysis });
      logger.info(
        {
          cluster: {
            serviceName: cluster.serviceName,
            alertType: cluster.alertType,
          },
          analysis: analysis ?? 'unavailable',
        },
        '--- Junando Notification ---',
      );
      notificationsTotal.inc({ channel: 'unknown', outcome: 'success' });
      return {
        outcome: NotifyOutcome.Success,
        latencyMs: Date.now() - startMs,
        channels: ['console'],
      };
    } catch (err) {
      notificationsTotal.inc({ channel: 'unknown', outcome: 'failure' });
      throw err;
    }
  }
}
