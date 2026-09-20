import { z } from 'zod';
import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ILLMProvider, LLMResult } from '../../domain/ports/index.js';
import { LLM_MAX_TOKENS, LLMProviderType } from '../../shared/constants.js';
import { createLogger } from '../../shared/logger/index.js';
import { llmInferenceDuration, llmInferenceTotal } from '../../shared/metrics/index.js';
import { buildUserPrompt, parseLlmText, SYSTEM_PROMPT } from './shared.js';

const logger = createLogger();

const VERCEL_AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

/**
 * Schema for Vercel AI Gateway's OpenAI-compatible response validation.
 * Ensures type safety at the external boundary.
 */
export const VercelGatewayResponseSchema = z.object({
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

export type VercelGatewayResponse = z.infer<typeof VercelGatewayResponseSchema>;

/**
 * LLM provider for Vercel AI Gateway's OpenAI-compatible endpoint.
 * Model strings are "creator/model" (e.g. "typesafeai/jev", "anthropic/claude-3-5-haiku") —
 * see https://vercel.com/ai-gateway/models. Unlike the other providers, there is
 * no sensible default model, so `model` is required.
 */
export class VercelGatewayProvider implements ILLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    if (!model) {
      throw new Error('VercelGatewayProvider requires an explicit model (e.g. "typesafeai/jev")');
    }
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

    const res = await fetch(VERCEL_AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: LLM_MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const latencyMs = Date.now() - startMs;
    const raw = await res.json();

    if (!res.ok) {
      logger.warn(
        { status: res.status, body: raw, model: this.model, correlationId },
        'llm:request:failed',
      );
      llmInferenceTotal.inc({ status: res.status === 429 ? 'rate_limited' : 'error' });
      throw new Error(`Vercel AI Gateway request failed: ${res.status}`);
    }

    const parsed = VercelGatewayResponseSchema.safeParse(raw);
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
      provider: LLMProviderType.VercelGateway,
      model: this.model,
      latencyMs,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
    };
  }
}
