import type { Message } from "@aws-sdk/client-sqs";
import type { NormalizedAlert } from "../../../packages/core/src/domain/entities/alert.js";
import type { TraceabilityDocument } from "../../../packages/core/src/domain/entities/traceability.js";

// ─────────────────────────────────────────────────────────────────────────────
// IMessageMapper — contract that every source-specific mapper must satisfy.
// Registered at module load time via registerMapper().
// ─────────────────────────────────────────────────────────────────────────────
export interface IMessageMapper {
  readonly kind: string;
  decode(message: Message): unknown;
  toNormalizedAlerts(decoded: unknown): NormalizedAlert[];
  toTraceabilityDocument(decoded: unknown, message: Message): TraceabilityDocument;
  resolveCorrelationId(decoded: unknown, message: Message): string;
}

const registry = new Map<string, IMessageMapper>();

export function registerMapper(m: IMessageMapper): void {
  registry.set(m.kind, m);
}

export function getMapper(kind: string): IMessageMapper {
  const m = registry.get(kind);
  if (!m) {
    throw new Error(
      `Unknown mapper kind: "${kind}". Registered: ${[...registry.keys()].join(", ")}`,
    );
  }
  return m;
}
