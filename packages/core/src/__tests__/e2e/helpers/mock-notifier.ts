import type { AlertCluster } from '../../../domain/entities/cluster.js';
import type { LLMAnalysis } from '../../../domain/entities/incident.js';
import type { INotifier } from '../../../domain/ports/index.js';

/**
 * MockNotifier — records every send() invocation in a call log. Tests assert
 * against `calls` instead of spying on individual methods, so the assertions
 * stay readable and the production interface stays honest.
 *
 * Tracks the optional `channel` parameter for multi-channel routing tests.
 */
export class MockNotifier implements INotifier {
  readonly calls: Array<{
    cluster: AlertCluster;
    analysis: LLMAnalysis | null;
    channel?: string;
  }> = [];

  async send(
    cluster: AlertCluster,
    analysis: LLMAnalysis | null,
    channel?: string,
  ): Promise<void> {
    this.calls.push({ cluster, analysis, channel });
  }
}
