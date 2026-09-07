import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ILLMProvider, LLMResult, LlmDegradedReason } from '../../domain/ports/index.js';
import {
  HTTP_TIMEOUT_MS,
  LLM_MAX_TOKENS,
  LLM_MODELS,
  LLMProviderType,
} from '../../shared/constants.js';
import { buildUserPrompt, parseLlmText, SYSTEM_PROMPT } from './shared.js';

/**
 * Recognized transient Bedrock error names, mapped to their degradedReason.
 * Any other error name (or non-Error rejection) is rethrown by the caller.
 */
const BEDROCK_AVAILABILITY_ERRORS: ReadonlyMap<string, LlmDegradedReason> = new Map([
  ['ThrottlingException', 'provider_unavailable'],
  ['ServiceUnavailableException', 'provider_unavailable'],
  ['InternalServerException', 'provider_unavailable'],
  ['ModelTimeoutException', 'timeout'],
  // Our own request-timeout abort (see analyze()) — not a Bedrock-issued error.
  ['AbortError', 'timeout'],
]);

function classifyBedrockError(error: unknown): LlmDegradedReason | undefined {
  if (!(error instanceof Error)) return undefined;
  return BEDROCK_AVAILABILITY_ERRORS.get(error.name);
}

/**
 * Bedrock LLM provider using AWS Bedrock Runtime's Converse API.
 * No circuit breaker — Bedrock's own throttling/timeout errors are
 * classified directly into a degradedReason.
 */
export class BedrockProvider implements ILLMProvider {
  private client: BedrockRuntimeClient | null = null;

  constructor(private readonly model: string = LLM_MODELS.Bedrock) {}

  private getClient(): BedrockRuntimeClient {
    if (!this.client) {
      this.client = new BedrockRuntimeClient({});
    }
    return this.client;
  }

  async analyze(cluster: AlertCluster, traces: Record<string, unknown>[]): Promise<LLMResult> {
    const startMs = Date.now();
    // No circuit breaker (see class doc) — but an unbounded call could still
    // hang until the Lambda's own timeout. Bound it explicitly instead.
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), HTTP_TIMEOUT_MS.LLM);
    try {
      const response = await this.getClient().send(
        new ConverseCommand({
          modelId: this.model,
          system: [{ text: SYSTEM_PROMPT }],
          messages: [{ role: 'user', content: [{ text: buildUserPrompt(cluster, traces) }] }],
          inferenceConfig: { maxTokens: LLM_MAX_TOKENS },
        }),
        { abortSignal: abortController.signal },
      );

      // Bedrock may emit non-text content blocks (e.g. reasoningContent)
      // ahead of the answer — search rather than assume index 0.
      const text = response.output?.message?.content?.find((b) => b.text !== undefined)?.text ?? '';
      return {
        ...parseLlmText(text),
        provider: LLMProviderType.Bedrock,
        model: this.model,
        latencyMs: Date.now() - startMs,
        promptTokens: response.usage?.inputTokens ?? 0,
        completionTokens: response.usage?.outputTokens ?? 0,
      };
    } catch (error) {
      const degradedReason = classifyBedrockError(error);
      if (degradedReason === undefined) throw error;
      return {
        analysis: null,
        degradedReason,
        provider: LLMProviderType.Bedrock,
        model: this.model,
        latencyMs: Date.now() - startMs,
        promptTokens: 0,
        completionTokens: 0,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
