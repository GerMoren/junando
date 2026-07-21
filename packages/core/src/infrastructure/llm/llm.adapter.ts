import * as Breaker from 'opossum';
import { z } from 'zod';
import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../domain/entities/incident.js';
import { LLMAnalysisSchema } from '../../domain/entities/incident.js';
import type { ILLMProvider, LLMResult } from '../../domain/ports/index.js';
import {
  CIRCUIT_BREAKER,
  LLM_FALLBACK_DEFAULTS,
  LLM_MAX_TOKENS,
  LLM_MODELS,
  LLMProviderType,
} from '../../shared/constants.js';
import { createLogger } from '../../shared/logger/index.js';
import { llmInferenceDuration, llmInferenceTotal } from '../../shared/metrics/index.js';

const logger = createLogger();

/** Provider name reported by MockLLMProvider results. */
const MOCK_PROVIDER_NAME = 'mock';

/**
 * Internal carrier: what each provider's raw call produces before the
 * shared metadata (provider, model, latencyMs) is attached.
 */
interface LlmRawResult {
  analysis: LLMAnalysis;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Schema for OpenRouter API response validation.
 * Ensures type safety at the external boundary.
 */
export const OpenRouterResponseSchema = z.object({
  id: z.string().optional(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.string(),
        content: z.string().optional(),
      }),
      finish_reason: z.string().optional(),
    }),
  ),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>;

const SYSTEM_PROMPT = `You are a senior Site Reliability Engineer.
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

const BREAKER_OPTIONS = {
  timeout: CIRCUIT_BREAKER.Timeout,
  errorThresholdPercentage: CIRCUIT_BREAKER.ErrorThresholdPercentage,
  resetTimeout: CIRCUIT_BREAKER.ResetTimeoutMs,
};

/**
 * Builds the user-facing prompt sent to the LLM for analysis.
 * Includes cluster summary and trace count for context.
 */
function buildUserPrompt(cluster: AlertCluster, traces: Record<string, unknown>[]): string {
  return `Service:${cluster.serviceName} Error:${cluster.alertType} Alerts:${cluster.alertCount} Latency:${cluster.latencyP99Ms ?? 'N/A'} Traces:${traces.length}`;
}

/**
 * Extracts LLMAnalysis from raw LLM response text.
 * Uses multi-stage parsing: JSON → regex fallback → heuristics.
 * Returns validated LLMAnalysis or falls back to default values.
 */
function parseAnalysis(raw: string, correlationId?: string): LLMAnalysis {
  const startIdx = raw.indexOf('{');
  const endIdx = raw.lastIndexOf('}');

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    try {
      return LLMAnalysisSchema.parse(JSON.parse(raw.slice(startIdx, endIdx + 1)));
    } catch {
      logger.warn(
        { rawResponse: raw.slice(0, 500), correlationId },
        'llm:parse:failed',
      );
    }
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
    return LLMAnalysisSchema.parse(analysis);
  }

  const lowerRaw = raw.toLowerCase();
  let urgencyLevel: LLMAnalysis['urgency_level'] = 'medium';
  if (lowerRaw.includes('critical') || lowerRaw.includes('severity 1')) urgencyLevel = 'critical';
  else if (lowerRaw.includes('high') || lowerRaw.includes('severity 2')) urgencyLevel = 'high';
  else if (lowerRaw.includes('low')) urgencyLevel = 'low';

  return LLMAnalysisSchema.parse({
    probable_cause: 'Analysis in progress - check logs for details',
    impacted_services: ['unknown-service'],
    recommended_steps: ['Review incident details in logs'],
    urgency_level: urgencyLevel,
    requires_rollback: lowerRaw.includes('rollback') || lowerRaw.includes('revert'),
  });
}

/**
 * Gemini LLM provider using Google Generative AI SDK.
 * Wrapped with circuit breaker for resilience.
 */
export class GeminiProvider implements ILLMProvider {
  private readonly breaker: InstanceType<typeof Breaker.default>;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = LLM_MODELS.Gemini,
  ) {
    this.breaker = new Breaker.default(this.analyzeRaw.bind(this), BREAKER_OPTIONS);
  }

  async analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMResult> {
    const startMs = Date.now();
    const raw = await this.analyzeWithBreaker(cluster, traces);
    return {
      ...raw,
      provider: LLMProviderType.Gemini,
      model: this.model,
      latencyMs: Date.now() - startMs,
    };
  }

  private async analyzeWithBreaker(
    cluster: AlertCluster,
    traces: Record<string, unknown>[],
  ): Promise<LlmRawResult> {
    try {
      return (await this.breaker.fire(cluster, traces)) as LlmRawResult;
    } catch {
      return this.analyzeRaw(cluster, traces);
    }
  }

  private async analyzeRaw(
    cluster: AlertCluster,
    traces: Record<string, unknown>[],
  ): Promise<LlmRawResult> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const gemini = genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await gemini.generateContent(buildUserPrompt(cluster, traces));
    const usage = (
      result.response as {
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      }
    ).usageMetadata;
    return {
      analysis: parseAnalysis(result.response.text()),
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
    };
  }
}

/**
 * Claude LLM provider using Anthropic SDK.
 * Supports Claude Haiku and other models.
 */
export class ClaudeProvider implements ILLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = LLM_MODELS.Claude,
  ) {}

  async analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMResult> {
    const startMs = Date.now();
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: this.apiKey });

    const message = await client.messages.create({
      model: this.model,
      max_tokens: LLM_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(cluster, traces) }],
    });

    const text = message.content.find((b) => b.type === 'text')?.text ?? '';
    return {
      analysis: parseAnalysis(text),
      provider: LLMProviderType.Claude,
      model: this.model,
      latencyMs: Date.now() - startMs,
      promptTokens: message.usage?.input_tokens ?? 0,
      completionTokens: message.usage?.output_tokens ?? 0,
    };
  }
}

/**
 * Mock LLM provider for testing and local development.
 * Returns deterministic responses without external API calls.
 */
export class MockLLMProvider implements ILLMProvider {
  readonly callLog: Array<{ cluster: AlertCluster }> = [];

  async analyze(cluster: AlertCluster, _traces: Record<string, unknown>[]): Promise<LLMResult> {
    this.callLog.push({ cluster });
    return {
      analysis: {
        probable_cause: `Mock: ${cluster.alertType} on ${cluster.serviceName}`,
        impacted_services: [cluster.serviceName],
        recommended_steps: ['Check the logs', 'Verify the deployment'],
        urgency_level: 'high',
        requires_rollback: false,
      },
      provider: MOCK_PROVIDER_NAME,
      model: MOCK_PROVIDER_NAME,
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
    };
  }
}

/**
 * Options for configuring the OpenRouter fallback chain.
 * Infra-internal — not exported.
 */
interface FallbackOptions {
  fallbackModels?: string[];
  fallbackTimeoutMs?: number;
}

/**
 * OpenRouter LLM provider using OpenAI-compatible API.
 * Supports various open models (Qwen, etc.) via OpenRouter gateway.
 * When the primary model exhausts 429 retries, cycles through fallbackModels.
 */
export class OpenRouterProvider implements ILLMProvider {
  private readonly fallbackModels: string[];
  private readonly fallbackTimeoutMs: number;
  private readonly providerName: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = LLM_MODELS.OpenRouter,
    fallbackModels: string[] = [],
    fallbackTimeoutMs: number = LLM_FALLBACK_DEFAULTS.TimeoutMs,
    providerName: string = LLMProviderType.OpenRouter,
  ) {
    // Deduplicate: remove primary model from fallback list at construction time
    this.fallbackModels = fallbackModels.filter((m) => m !== model);
    this.fallbackTimeoutMs = fallbackTimeoutMs;
    this.providerName = providerName;
  }

  async analyze(
    cluster: AlertCluster,
    traces: Record<string, unknown>[],
    correlationId?: string,
  ): Promise<LLMResult> {
    const prompt = buildUserPrompt(cluster, traces);
    logger.debug({ model: this.model, promptLength: prompt.length, correlationId }, 'llm:request:start');

    const startMs = Date.now();

    // Retry once on 429 using the Retry-After header from OpenRouter
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env['APP_URL'] ?? 'https://junando.app',
          'X-Title': 'Junando SRE',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          // Note: json_object response_format is NOT supported by all OpenRouter models.
          // Qwen free tier ignores it or returns an error — rely on prompt instructions only.
        }),
      });

      const latencyMs = Date.now() - startMs;
      const raw = await res.json();

      if (!res.ok) {
        const retryAfter = Number(
          (raw as { error?: { metadata?: { retry_after_seconds?: number } } })
            ?.error?.metadata?.retry_after_seconds ?? 0,
        );

        logger.warn(
          { status: res.status, body: raw, model: this.model, correlationId, attempt, retryAfter },
          'llm:request:failed',
        );

        if (res.status === 429 && attempt === 0) {
          // Some providers (Google AI Studio) do NOT return retry_after_seconds.
          // Default to a 5s backoff in that case. Cap at 30s so Lambda doesn't time out.
          const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 5_000;
          logger.info({ waitMs, retryAfter, correlationId }, 'llm:retry:waiting');
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        if (res.status === 429) {
          if (this.fallbackModels.length > 0) {
            // Primary model exhausted — try fallback chain
            const deadlineMs = Date.now() + this.fallbackTimeoutMs;
            return this.analyzeFallback(prompt, correlationId, deadlineMs, this.model, startMs);
          }
          llmInferenceTotal.inc({ status: 'rate_limited' });
          throw new Error(`OpenRouter API failed: ${res.status}`);
        }

        llmInferenceTotal.inc({ status: 'error' });
        throw new Error(`OpenRouter API failed: ${res.status}`);
      }

      const parsed = OpenRouterResponseSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn({ errors: parsed.error.format(), correlationId }, 'llm:validation:failed');
      }

      const text = parsed.success ? (parsed.data.choices?.[0]?.message?.content ?? '') : '';
      const analysis = parseAnalysis(text, correlationId);
      const usage = parsed.success ? parsed.data.usage : undefined;

      if (usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = usage;
        logger.info(
          {
            model: this.model,
            usage: { promptTokens: prompt_tokens, completionTokens: completion_tokens, totalTokens: total_tokens },
            latencyMs,
            correlationId,
          },
          'llm:request:success',
        );
      }

      llmInferenceTotal.inc({ status: 'success' });
      llmInferenceDuration.observe({ model: this.model }, latencyMs / 1000);

      return {
        analysis,
        provider: this.providerName,
        model: this.model,
        latencyMs,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      };
    }

    throw new Error('OpenRouter API failed after retry');
  }

  private async analyzeFallback(
    prompt: string,
    correlationId: string | undefined,
    deadlineMs: number,
    fromModel: string,
    startMs: number,
  ): Promise<LLMResult> {
    for (const toModel of this.fallbackModels) {
      if (Date.now() >= deadlineMs) {
        throw new Error('OpenRouter fallback chain timed out');
      }

      logger.info({ from_model: fromModel, to_model: toModel, reason: '429', correlationId }, 'llm:fallback:hop');

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env['APP_URL'] ?? 'https://junando.app',
          'X-Title': 'Junando SRE',
        },
        body: JSON.stringify({
          model: toModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      });

      const raw = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          fromModel = toModel;
          continue;
        }
        throw new Error(`OpenRouter API failed: ${res.status}`);
      }

      const parsed = OpenRouterResponseSchema.safeParse(raw);
      const text = parsed.success ? (parsed.data.choices?.[0]?.message?.content ?? '') : '';
      const usage = parsed.success ? parsed.data.usage : undefined;
      return {
        analysis: parseAnalysis(text, correlationId),
        provider: this.providerName,
        model: toModel,
        latencyMs: Date.now() - startMs,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      };
    }

    throw new Error('OpenRouter API exhausted all models');
  }
}

/**
 * Factory type for creating LLM providers.
 * Takes API key and optional model override.
 */
type LLMFactory = (apiKey: string, model?: string, options?: FallbackOptions) => ILLMProvider;

/**
 * Registry mapping provider names to their factory functions.
 * Used by createLLMProvider to instantiate the appropriate LLM client.
 */
const LLM_PROVIDER_REGISTRY: ReadonlyMap<string, LLMFactory> = new Map<string, LLMFactory>([
  [LLMProviderType.Gemini, (apiKey, model) => new GeminiProvider(apiKey, model)],
  [LLMProviderType.Claude, (apiKey, model) => new ClaudeProvider(apiKey, model)],
  [LLMProviderType.OpenRouter, (apiKey, model, options) => new OpenRouterProvider(apiKey, model, options?.fallbackModels, options?.fallbackTimeoutMs, LLMProviderType.OpenRouter)],
  [LLMProviderType.Qwen, (apiKey, model, options) => new OpenRouterProvider(apiKey, model, options?.fallbackModels, options?.fallbackTimeoutMs, LLMProviderType.Qwen)],
]);

export function createLLMProvider(provider: string, apiKey: string, model?: string, options?: FallbackOptions): ILLMProvider {
  const factory = LLM_PROVIDER_REGISTRY.get(provider);
  if (!factory) {
    const supported = Array.from(LLM_PROVIDER_REGISTRY.keys()).join(', ');
    throw new Error(`Unknown LLM_PROVIDER: "${provider}". Supported: ${supported}`);
  }
  return factory(apiKey, model, options);
}
