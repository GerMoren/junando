import type { Message } from "@aws-sdk/client-sqs";
import type { IIndexer, TraceabilityDocument } from "../../../packages/core/src/index.js";
import type { IMessageMapper } from "../mappers/registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// createSqsIndexerProcessor
// Decodes an SQS message via the injected mapper, maps it to a
// TraceabilityDocument, then delegates to the indexer.
// This path does NOT run ProcessIncidentUseCase, clustering, or notifiers.
// ─────────────────────────────────────────────────────────────────────────────
export function createSqsIndexerProcessor(deps: {
  mapper: IMessageMapper;
  indexer: IIndexer<TraceabilityDocument>;
}): (message: Message) => Promise<void> {
  return async (message: Message): Promise<void> => {
    const decoded = deps.mapper.decode(message);
    const doc = deps.mapper.toTraceabilityDocument(decoded, message);
    await deps.indexer.index(doc);
  };
}
