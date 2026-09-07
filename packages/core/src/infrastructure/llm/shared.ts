import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import { LLMAnalysisSchema } from '../../domain/entities/incident.js';
import type { LlmDegradedReason } from '../../domain/ports/index.js';
import { createLogger } from '../../shared/logger/index.js';

const logger = createLogger();

/**
 * Internal carrier: what each provider's raw call produces before the
 * shared metadata (provider, model, latencyMs) is attached.
 */
export interface LlmRawResult {
  analysis: LLMAnalysis | null;
  degradedReason?: LlmDegradedReason;
  promptTokens: number;
  completionTokens: number;
}

/** Result of parsing raw LLM text into a diagnosis, or a reason it failed. */
export interface ParsedAnalysis {
  analysis: LLMAnalysis | null;
  degradedReason?: LlmDegradedReason;
}

export const SYSTEM_PROMPT = `You are a senior Site Reliability Engineer.
Respond ONLY with raw JSON, no markdown, no text before or after:
{"probable_cause":"string","impacted_services":["string"],"recommended_steps":["string"],"urgency_level":"low|medium|high|critical","requires_rollback":true|false}`;

/**
 * Pre-compiled regex patterns for parsing LLM responses.
 * Hoisted to module level to avoid recompilation on every parseAnalysis call.
 * Matches JSON field extraction from raw LLM output.
 */
const RE_PROBABLE_CAUSE = /"probable_cause"\s*:\s*"([^"]+)"/;
const RE_URGENCY_LEVEL = /"urgency_level"\s*:\s*"([^"]+)"/;
const RE_REQUIRES_ROLLBACK = /"requires_rollback"\s*:\s*(true|false)/;
const RE_RECOMMENDED_STEPS = /"recommended_steps"\s*:\s*\[([^\]]+)\]/;
const RE_IMPACTED_SERVICES = /"impacted_services"\s*:\s*\[([^\]]+)\]/;

/**
 * Builds the user-facing prompt sent to the LLM for analysis.
 * Includes cluster summary and trace count for context.
 */
export function buildUserPrompt(cluster: AlertCluster, traces: Record<string, unknown>[]): string {
  return `Service:${cluster.serviceName} Error:${cluster.alertType} Alerts:${cluster.alertCount} Latency:${cluster.latencyP99Ms ?? 'N/A'} Traces:${traces.length}`;
}

/**
 * Extracts LLMAnalysis from raw LLM response text.
 * Two-stage parsing: JSON → regex fallback. Never fabricates a diagnosis —
 * returns null when neither stage produces a usable analysis.
 */
export function parseAnalysis(raw: string, correlationId?: string): LLMAnalysis | null {
  const startIdx = raw.indexOf('{');
  const endIdx = raw.lastIndexOf('}');
  let stage1Succeeded = false;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    try {
      const analysis = LLMAnalysisSchema.parse(JSON.parse(raw.slice(startIdx, endIdx + 1)));
      stage1Succeeded = true;
      return analysis;
    } catch {
      // fall through to stage 2 — warn logged below, outside the brace guard
    }
  }

  if (!stage1Succeeded) {
    logger.warn({ rawResponse: raw.slice(0, 500), correlationId }, 'llm:parse:failed');
  }

  const probableCauseMatch = RE_PROBABLE_CAUSE.exec(raw);
  const urgencyMatch = RE_URGENCY_LEVEL.exec(raw);
  const rollbackMatch = RE_REQUIRES_ROLLBACK.exec(raw);
  const stepsMatch = RE_RECOMMENDED_STEPS.exec(raw);
  const servicesMatch = RE_IMPACTED_SERVICES.exec(raw);

  const probableCause = probableCauseMatch?.[1];
  const urgency = urgencyMatch?.[1];

  if (probableCause && urgency) {
    const steps: string[] = stepsMatch?.[1] ? (JSON.parse(`[${stepsMatch[1]}]`) as string[]) : [];
    const services: string[] = servicesMatch?.[1]
      ? (JSON.parse(`[${servicesMatch[1]}]`) as string[])
      : ['unknown-service'];
    const analysis: LLMAnalysis = {
      probable_cause: probableCause,
      impacted_services: services,
      recommended_steps: steps,
      urgency_level: urgency as LLMAnalysis['urgency_level'],
      requires_rollback: rollbackMatch?.[1] === 'true',
    };
    const parsed = LLMAnalysisSchema.parse(analysis);
    logger.warn(
      { matchedFields: ['probable_cause', 'urgency_level'], correlationId },
      'llm:parse:partial',
    );
    return parsed;
  }

  logger.warn({ correlationId }, 'llm:parse:unusable');
  return null;
}

/**
 * Shared entry point for turning provider text into a diagnosis (or a
 * degradedReason explaining why not). Detects empty responses once, here,
 * before delegating to parseAnalysis.
 */
export function parseLlmText(raw: string, correlationId?: string): ParsedAnalysis {
  if (raw.trim() === '') {
    logger.warn({ correlationId }, 'llm:parse:empty');
    return { analysis: null, degradedReason: 'empty_response' };
  }
  const analysis = parseAnalysis(raw, correlationId);
  return analysis ? { analysis } : { analysis: null, degradedReason: 'unparseable_response' };
}
