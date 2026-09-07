import { GoogleGenerativeAI, GoogleGenerativeAIAbortError } from '@google/generative-ai';
import * as Breaker from 'opossum';
import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ILLMProvider, LLMResult, LlmDegradedReason } from '../../domain/ports/index.js';
import { CIRCUIT_BREAKER, LLM_MODELS, LLMProviderType } from '../../shared/constants.js';
import { buildUserPrompt, parseLlmText, SYSTEM_PROMPT, type LlmRawResult } from './shared.js';

const OPOSSUM_TIMEOUT_CODE = 'ETIMEDOUT';
const OPOSSUM_OPEN_BREAKER_CODE = 'EOPENBREAKER';
const UNDICI_CONNECT_TIMEOUT_CODE = 'UND_ERR_CONNECT_TIMEOUT';

interface ErrorLike {
  code?: unknown;
  cause?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null;
}

function hasTimeoutCode(error: ErrorLike): boolean {
  return error.code === OPOSSUM_TIMEOUT_CODE || error.code === UNDICI_CONNECT_TIMEOUT_CODE;
}

function isStandardFetchTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

function classifyGeminiAvailabilityError(error: unknown): LlmDegradedReason | undefined {
  if (!isErrorLike(error)) return undefined;

  if (error.code === OPOSSUM_OPEN_BREAKER_CODE) return 'circuit_breaker_open';
  if (hasTimeoutCode(error)) return 'timeout';
  if (error instanceof GoogleGenerativeAIAbortError) return 'timeout';
  if (isStandardFetchTimeout(error)) return 'timeout';

  if (
    isErrorLike(error.cause) &&
    (hasTimeoutCode(error.cause) || isStandardFetchTimeout(error.cause))
  ) {
    return 'timeout';
  }

  return undefined;
}

function degradedGeminiResult(degradedReason: LlmDegradedReason): LlmRawResult {
  return {
    analysis: null,
    degradedReason,
    promptTokens: 0,
    completionTokens: 0,
  };
}

const BREAKER_OPTIONS = {
  timeout: CIRCUIT_BREAKER.Timeout,
  errorThresholdPercentage: CIRCUIT_BREAKER.ErrorThresholdPercentage,
  resetTimeout: CIRCUIT_BREAKER.ResetTimeoutMs,
};

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
    } catch (error) {
      const degradedReason = classifyGeminiAvailabilityError(error);
      if (degradedReason !== undefined) return degradedGeminiResult(degradedReason);
      throw error;
    }
  }

  private async analyzeRaw(
    cluster: AlertCluster,
    traces: Record<string, unknown>[],
  ): Promise<LlmRawResult> {
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
      ...parseLlmText(result.response.text()),
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
    };
  }
}
