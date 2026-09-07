import { z } from 'zod';
import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ILLMProvider, LLMResult } from '../../domain/ports/index.js';
import { LLM_FALLBACK_DEFAULTS, LLMProviderType, LLM_MODELS } from '../../shared/constants.js';
import { createLogger } from '../../shared/logger/index.js';
import { llmInferenceDuration, llmInferenceTotal } from '../../shared/metrics/index.js';
import { buildUserPrompt, parseLlmText, SYSTEM_PROMPT } from './shared.js';

const logger = createLogger();

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

/**
 * Options for configuring the OpenRouter fallback chain.
 * Infra-internal — not exported.
 */
export interface FallbackOptions {
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
    logger.debug(
      { model: this.model, promptLength: prompt.length, correlationId },
      'llm:request:start',
    );

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
          (raw as { error?: { metadata?: { retry_after_seconds?: number } } })?.error?.metadata
            ?.retry_after_seconds ?? 0,
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
      const parsedAnalysis = parseLlmText(text, correlationId);
      const usage = parsed.success ? parsed.data.usage : undefined;

      if (usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = usage;
        logger.info(
          {
            model: this.model,
            usage: {
              promptTokens: prompt_tokens,
              completionTokens: completion_tokens,
              totalTokens: total_tokens,
            },
            latencyMs,
            correlationId,
          },
          'llm:request:success',
        );
      }

      llmInferenceTotal.inc({ status: 'success' });
      llmInferenceDuration.observe({ model: this.model }, latencyMs / 1000);

      return {
        ...parsedAnalysis,
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

      logger.info(
        { from_model: fromModel, to_model: toModel, reason: '429', correlationId },
        'llm:fallback:hop',
      );

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
        ...parseLlmText(text, correlationId),
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
