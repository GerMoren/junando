/**
 * IndexerIncidentProcessor — indexes TraceabilityDocument for already-normalized alerts.
 *
 * Unlike TraceabilityIncidentProcessor, this does NOT implement IncidentProcessor.
 * It is used directly by the SQS subscriber for the indexing-only path.
 *
 * Note: PipelineOptions.enableTraceabilityIndexing is always honored — if false,
 * indexing is skipped and a success result is returned.
 */
import type { NormalizedAlert } from '@junando/core';
import type { IIndexer, TraceabilityDocument } from '../../../packages/core/src/index.js';

export interface IndexerProcessorDeps {
  mapper: {
    toTraceabilityDocument(
      decoded: unknown,
      message: { messageId: string | undefined },
    ): TraceabilityDocument;
  };
  indexer: Pick<IIndexer<TraceabilityDocument>, 'index'>;
}

export async function indexAlert(
  deps: IndexerProcessorDeps,
  alert: NormalizedAlert,
  enableTraceabilityIndexing: boolean,
): Promise<void> {
  if (!enableTraceabilityIndexing) return;

  const doc = deps.mapper.toTraceabilityDocument(alert, { messageId: alert.traceId });
  await deps.indexer.index(doc);
}