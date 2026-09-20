import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ITriageProvider, TriageResult, TriageSeverity } from '../../domain/ports/index.js';
import { VERCEL_AI_GATEWAY_URL } from '../../shared/constants.js';
import { createLogger } from '../../shared/logger/index.js';

const logger = createLogger();

const TRIAGE_SYSTEM_PROMPT = 'You are a strict severity classifier. Respond with exactly one word.';

// 5 tokens is enough for a plain instruction-following model, but reasoning
// models (e.g. qwen3's "thinking" variants) emit a reasoning preamble first
// and get truncated (finish_reason: "length") before writing the actual
// word — confirmed live against alibaba/qwen-3-14b via Vercel AI Gateway,
// which always produced an empty `content` under the old 5-token budget.
// 32 gives a small reasoning model enough room to finish a short preamble
// and still land on the label; pick a non-reasoning model for triage where
// possible, since latency/cost both suffer otherwise.
const TRIAGE_MAX_TOKENS = 32;

const VALID_SEVERITIES: ReadonlySet<TriageSeverity> = new Set([
  'low',
  'medium',
  'high',
  'critical',
]);

function isTriageSeverity(value: string): value is TriageSeverity {
  return VALID_SEVERITIES.has(value as TriageSeverity);
}

function buildTriagePrompt(cluster: AlertCluster): string {
  return `Classify the severity of this alert cluster as exactly one word: LOW, MEDIUM, HIGH, or CRITICAL. No explanation, no punctuation, just the one word.

Service: ${cluster.serviceName}
Alert type: ${cluster.alertType}
Alert count: ${cluster.alertCount}
Endpoint: ${cluster.endpointPath ?? 'unknown'}`;
}

/**
 * Cheap severity triage provider using Vercel AI Gateway's OpenAI-compatible
 * endpoint. Runs before the full LLM analysis so low-severity incidents can
 * skip the expensive call. Fail-open by design: any failure mode (network
 * error, non-2xx status, unparseable content) defaults to 'medium' rather
 * than throwing, so a triage hiccup never suppresses a real incident — it
 * just proceeds to the full analysis via the normal medium/high/critical path.
 */
export class VercelGatewayTriageProvider implements ITriageProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async classify(cluster: AlertCluster): Promise<TriageResult> {
    const prompt = buildTriagePrompt(cluster);

    try {
      const res = await fetch(VERCEL_AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: TRIAGE_MAX_TOKENS,
          messages: [
            { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        logger.warn(
          { status: res.status, model: this.model },
          'triage:request:failed — defaulting to medium',
        );
        return { severity: 'medium' };
      }

      const raw = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = raw.choices?.[0]?.message?.content ?? '';
      const normalized = content.trim().toUpperCase();

      if (isTriageSeverity(normalized.toLowerCase())) {
        return { severity: normalized.toLowerCase() as TriageSeverity };
      }

      logger.warn({ content, model: this.model }, 'triage:unparseable_response — defaulting to medium');
      return { severity: 'medium' };
    } catch (err) {
      logger.warn({ err, model: this.model }, 'triage:request:error — defaulting to medium');
      return { severity: 'medium' };
    }
  }
}
