import type { AlertCluster } from '../../domain/entities/cluster.js';
import type { ILLMProvider, LLMResult } from '../../domain/ports/index.js';

/** Provider name reported by MockLLMProvider results. */
const MOCK_PROVIDER_NAME = 'mock';

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
