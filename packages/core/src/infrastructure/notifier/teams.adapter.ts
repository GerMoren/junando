import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import type { INotifier } from '../../domain/ports/index.js';
import { TEAMS_WEBHOOK_TIMEOUT_MS, URGENCY_EMOJI } from '../../shared/constants.js';
import { notificationsTotal } from '../../shared/metrics/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// TeamsNotifierError — domain error type for Teams adapter failures.
// Discriminable type for catch blocks.
// ─────────────────────────────────────────────────────────────────────────────

export class TeamsNotifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamsNotifierError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sanitizeText — strips HTML, escapes Adaptive Card markdown chars,
// collapses excess newlines, truncates to maxLength.
// Pure function — no side effects.
// ─────────────────────────────────────────────────────────────────────────────

export function sanitizeText(s: string, maxLength = 4_000): string {
  // 1. Strip HTML tags
  let result = s.replace(/<[^>]*>/g, '');

  // 2. Escape Adaptive Card markdown special chars
  result = result.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/_/g, '\\_');

  // 3. Collapse excess newlines (>5 consecutive)
  result = result.replace(/(\n){6,}/g, '\n\n\n\n\n…');

  // 4. Truncate to maxLength
  if (result.length > maxLength) {
    result = result.slice(0, maxLength) + '…';
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive Card payload builders
// ─────────────────────────────────────────────────────────────────────────────

function buildAnalysisCard(cluster: AlertCluster, analysis: LLMAnalysis): object {
  const emoji = URGENCY_EMOJI[analysis.urgency_level] ?? '⚪';
  const safeName = sanitizeText(cluster.serviceName);
  const safeEndpoint = sanitizeText(cluster.endpointPath ?? 'unknown');
  const safeCause = sanitizeText(analysis.probable_cause);
  const safeSteps = analysis.recommended_steps
    .map((s, i) => `${i + 1}. ${sanitizeText(s)}`)
    .join('\n');
  const clusterUrl = `https://app.junando.io/clusters/${cluster.fingerprint}`;

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `${emoji} Incident — ${safeName}`,
        size: 'Large',
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Service', value: safeName },
          { title: 'Alerts', value: String(cluster.alertCount) },
          { title: 'Endpoint', value: safeEndpoint },
          { title: 'Urgency', value: `${emoji} ${analysis.urgency_level}` },
        ],
      },
      {
        type: 'TextBlock',
        text: '**Probable cause**',
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: safeCause,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: '**Recommended steps**',
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: safeSteps,
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'View in Junando',
        url: clusterUrl,
      },
    ],
  };
}

function buildFallbackCard(cluster: AlertCluster): object {
  const safeName = sanitizeText(cluster.serviceName);
  const clusterUrl = `https://app.junando.io/clusters/${cluster.fingerprint}`;

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: `⚠️ Incident — ${safeName} (no AI diagnosis)`,
        size: 'Large',
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Service', value: safeName },
          { title: 'Alerts', value: String(cluster.alertCount) },
        ],
      },
    ],
    actions: [
      {
        type: 'Action.OpenUrl',
        title: 'View in Junando',
        url: clusterUrl,
      },
    ],
  };
}

function buildAdaptiveCardPayload(card: object): object {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: card,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TeamsNotifier — Infrastructure adapter.
// Implements INotifier using Microsoft Teams Adaptive Cards via webhook.
// Swap for SlackNotifier without touching application or domain code.
// ─────────────────────────────────────────────────────────────────────────────

export class TeamsNotifier implements INotifier {
  // Pre-computed at construction so the error path never re-parses the URL.
  // If parsing happens inside the catch block and throws, the original error
  // context (timeout, network failure, etc.) would be lost.
  private readonly hostForErrors: string;

  constructor(
    private readonly webhookUrl: string,
    private readonly timeoutMs: number = TEAMS_WEBHOOK_TIMEOUT_MS,
  ) {
    let host = 'unknown';
    try {
      host = new URL(webhookUrl).hostname;
    } catch {
      // Leave as 'unknown'. Config validation should have rejected invalid URLs
      // upstream; this fallback exists only so the notifier can still produce
      // a meaningful error message instead of throwing in its own catch block.
    }
    this.hostForErrors = host;
  }

  async send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<void> {
    const card = analysis ? buildAnalysisCard(cluster, analysis) : buildFallbackCard(cluster);
    const payload = buildAdaptiveCardPayload(card);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Round 2 hardening: never include the response body in error messages.
        // Power Automate / Logic Apps echo parts of the request URL (including
        // SAS tokens like sig=, code=, sv=, sp=) and chasing every encoding
        // variant is a losing game. Status + host gives enough diagnostic
        // signal without any leak surface.
        throw new TeamsNotifierError(
          `Teams webhook error ${res.status} (host: ${this.hostForErrors})`,
        );
      }

      notificationsTotal.inc({ channel: 'teams', outcome: 'success' });
    } catch (err) {
      if (err instanceof TeamsNotifierError) {
        notificationsTotal.inc({ channel: 'teams', outcome: 'failure' });
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        // TNT-08: log host only — never full URL (no sig= or api-version= query).
        // TNT-10: host is pre-computed; no URL parsing in the error path.
        const timeoutErr = new TeamsNotifierError(
          `Teams webhook timed out after ${this.timeoutMs}ms (host: ${this.hostForErrors})`,
        );
        notificationsTotal.inc({ channel: 'teams', outcome: 'failure' });
        throw timeoutErr;
      }
      notificationsTotal.inc({ channel: 'teams', outcome: 'failure' });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
