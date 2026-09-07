import type { ILLMProvider } from '../../domain/ports/index.js';
import { LLMProviderType } from '../../shared/constants.js';
import { BedrockProvider } from './bedrock.provider.js';
import { ClaudeProvider } from './claude.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { OpenRouterProvider, type FallbackOptions } from './openrouter.provider.js';

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
  [
    LLMProviderType.OpenRouter,
    (apiKey, model, options) =>
      new OpenRouterProvider(
        apiKey,
        model,
        options?.fallbackModels,
        options?.fallbackTimeoutMs,
        LLMProviderType.OpenRouter,
      ),
  ],
  [
    LLMProviderType.Qwen,
    (apiKey, model, options) =>
      new OpenRouterProvider(
        apiKey,
        model,
        options?.fallbackModels,
        options?.fallbackTimeoutMs,
        LLMProviderType.Qwen,
      ),
  ],
  // Bedrock authenticates by IAM role — the apiKey argument is unused by design.
  [LLMProviderType.Bedrock, (_apiKey, model) => new BedrockProvider(model)],
]);

export function createLLMProvider(
  provider: string,
  apiKey: string | undefined,
  model?: string,
  options?: FallbackOptions,
): ILLMProvider {
  const factory = LLM_PROVIDER_REGISTRY.get(provider);
  if (!factory) {
    const supported = Array.from(LLM_PROVIDER_REGISTRY.keys()).join(', ');
    throw new Error(`Unknown LLM_PROVIDER: "${provider}". Supported: ${supported}`);
  }
  return factory(apiKey ?? '', model, options);
}
