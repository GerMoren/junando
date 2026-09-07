import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ILLMProvider, LLMResult } from '../../domain/ports/index.js';
import { LLM_MAX_TOKENS, LLM_MODELS, LLMProviderType } from '../../shared/constants.js';
import { buildUserPrompt, parseLlmText, SYSTEM_PROMPT } from './shared.js';

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
      ...parseLlmText(text),
      provider: LLMProviderType.Claude,
      model: this.model,
      latencyMs: Date.now() - startMs,
      promptTokens: message.usage?.input_tokens ?? 0,
      completionTokens: message.usage?.output_tokens ?? 0,
    };
  }
}
