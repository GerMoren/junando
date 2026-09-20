import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ITriageProvider, TriageResult, TriageSeverity } from '../../domain/ports/index.js';
import { createLogger } from '../../shared/logger/index.js';

const logger = createLogger();

const VERCEL_AI_GATEWAY_EVALUATE_URL = 'https://ai-gateway.vercel.sh/v1/evaluate';

const JEV_MODEL = 'typesafe-ai/jev';

const SEVERITY_CRITERIA = {
  low: 'single low-impact alert, no user-facing impact',
  medium: 'moderate impact, some degradation',
  high: 'significant impact, many alerts or a critical endpoint',
  critical: 'severe outage, high alert count on a critical endpoint',
} as const;

const VALID_SEVERITIES: ReadonlySet<TriageSeverity> = new Set([
  'low',
  'medium',
  'high',
  'critical',
]);

function isTriageSeverity(value: string): value is TriageSeverity {
  return VALID_SEVERITIES.has(value as TriageSeverity);
}

interface EvaluateChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
}

interface EvaluateResponse {
  answers?: {
    severity?: EvaluateChoiceAnswer;
  };
}

/**
 * Cheap severity triage provider using Vercel AI Gateway's dedicated
 * Evaluation API (`POST /v1/evaluate`) against TypeSafe AI's Jev model —
 * a purpose-built decision/scoring model, not a chat-completions LLM.
 * This is the correct integration path: Jev is rejected on the
 * chat-completions endpoint ("is an evaluation model, not a language
 * model"), which is what VercelGatewayProvider/VercelGatewayTriageProvider
 * use. Confirmed live: returns a `choice` answer with per-option
 * probabilities and a `confidence` score, fast (~150ms) and — while Jev
 * remains in its free promotional window — at zero marginal cost.
 *
 * Fail-open by design, matching VercelGatewayTriageProvider: any failure
 * mode (network error, non-2xx, missing/unparseable answer) defaults to
 * 'medium' rather than throwing, so a triage hiccup never suppresses a
 * real incident.
 */
export class JevTriageProvider implements ITriageProvider {
  constructor(private readonly apiKey: string) {}

  async classify(cluster: AlertCluster): Promise<TriageResult> {
    const state = `Alert cluster: service=${cluster.serviceName}, alertType=${cluster.alertType}, alertCount=${cluster.alertCount}, endpoint=${cluster.endpointPath ?? 'unknown'}`;

    try {
      const res = await fetch(VERCEL_AI_GATEWAY_EVALUATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state,
          questions: {
            severity: {
              type: 'choice',
              instructions: 'Classify the severity of this alert cluster.',
              criteria: SEVERITY_CRITERIA,
            },
          },
        }),
      });

      if (!res.ok) {
        logger.warn({ status: res.status, model: JEV_MODEL }, 'triage:request:failed — defaulting to medium');
        return { severity: 'medium' };
      }

      const raw = (await res.json()) as EvaluateResponse;
      const choice = raw.answers?.severity?.choice ?? '';

      if (isTriageSeverity(choice)) {
        return { severity: choice };
      }

      logger.warn({ choice, model: JEV_MODEL }, 'triage:unparseable_response — defaulting to medium');
      return { severity: 'medium' };
    } catch (err) {
      logger.warn({ err, model: JEV_MODEL }, 'triage:request:error — defaulting to medium');
      return { severity: 'medium' };
    }
  }
}
