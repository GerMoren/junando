import type { INotifier } from '../../domain/ports/index.js'
import type { AlertCluster } from '../../domain/entities/cluster.js'
import type { LLMAnalysis } from '../../domain/entities/incident.js'

// ─────────────────────────────────────────────────────────────────────────────
// SlackNotifier — Infrastructure adapter.
// Implements INotifier using Slack Block Kit.
// Swap for TeamsNotifier without touching application or domain code.
// ─────────────────────────────────────────────────────────────────────────────

const URGENCY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '🟢',
}

export class SlackNotifier implements INotifier {
  constructor(
    private readonly botToken: string,
    private readonly channel: string,
  ) {}

  async send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void> {
    const payload = analysis
      ? this.buildAnalysisMessage(cluster, analysis)
      : this.buildFallbackMessage(cluster)

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify({ channel: this.channel, ...payload }),
    })

    if (!res.ok) throw new Error(`Slack API error: ${res.status}`)
    const body = await res.json() as { ok: boolean; error?: string }
    if (!body.ok) throw new Error(`Slack error: ${body.error}`)
  }

  private buildAnalysisMessage(cluster: AlertCluster, analysis: LLMAnalysis) {
    const emoji = URGENCY_EMOJI[analysis.urgency_level] ?? '⚪'
    const steps = analysis.recommended_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')

    return {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${emoji} Incident — ${cluster.serviceName}` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Service*\n${cluster.serviceName}` },
            { type: 'mrkdwn', text: `*Alerts*\n${cluster.alertCount}` },
            { type: 'mrkdwn', text: `*Endpoint*\n\`${cluster.endpointPath}\`` },
            { type: 'mrkdwn', text: `*Urgency*\n${emoji} ${analysis.urgency_level.toUpperCase()}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Probable cause*\n${analysis.probable_cause}` },
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
            ...(analysis.requires_rollback ? [{
              type: 'button',
              text: { type: 'plain_text', text: '⏪ Trigger Rollback' },
              style: 'danger',
              action_id: 'trigger_rollback',
              value: cluster.fingerprint,
              confirm: {
                title: { type: 'plain_text', text: 'Confirm rollback' },
                text: { type: 'plain_text', text: `Roll back ${cluster.serviceName}?` },
                confirm: { type: 'plain_text', text: 'Yes, rollback' },
                deny: { type: 'plain_text', text: 'Cancel' },
              },
            }] : []),
          ],
        },
      ],
    }
  }

  private buildFallbackMessage(cluster: AlertCluster) {
    return {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `⚠️ Incident — ${cluster.serviceName} (no AI diagnosis)` },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${cluster.alertCount} alerts* on \`${cluster.endpointPath}\` since ${cluster.firstSeenAt}\nLLM analysis unavailable — manual investigation required.`,
          },
        },
      ],
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ConsoleNotifier — Local dev / test adapter. Prints to stdout.
// ─────────────────────────────────────────────────────────────────────────────

export class ConsoleNotifier implements INotifier {
  readonly sent: Array<{ cluster: AlertCluster; analysis: LLMAnalysis | null }> = []

  async send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void> {
    this.sent.push({ cluster, analysis })
    console.log('\n--- Junando Notification ---')
    console.log('Cluster:', cluster.serviceName, cluster.errorType)
    console.log('Analysis:', analysis ?? 'unavailable')
    console.log('----------------------------\n')
  }
}
