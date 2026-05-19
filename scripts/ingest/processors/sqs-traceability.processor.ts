import type { Message } from "@aws-sdk/client-sqs";
import type { ProcessIncidentUseCase } from "../../../packages/core/src/index.js";
import type { IMessageMapper } from "../mappers/registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// createSqsTraceabilityProcessor
// Decodes an SQS message via the injected mapper, maps it to NormalizedAlerts,
// resolves a correlationId, then delegates to ProcessIncidentUseCase.
// ─────────────────────────────────────────────────────────────────────────────
export function createSqsTraceabilityProcessor(deps: {
  mapper: IMessageMapper;
  processIncidentUseCase: Pick<ProcessIncidentUseCase, "execute">;
}): (message: Message) => Promise<void> {
  return async (message: Message): Promise<void> => {
    const decoded = deps.mapper.decode(message);
    const alerts = deps.mapper.toNormalizedAlerts(decoded);
    const correlationId = deps.mapper.resolveCorrelationId(decoded, message);
    await deps.processIncidentUseCase.execute(alerts, correlationId);
  };
}
