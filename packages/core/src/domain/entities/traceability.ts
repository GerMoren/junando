// ─────────────────────────────────────────────────────────────────────────────
// TraceabilityDocument — generic shape indexed in OpenSearch.
// Source-agnostic. Client-specific mapping lives in the mapper registry.
// ─────────────────────────────────────────────────────────────────────────────
export interface TraceabilityDocument {
  '@timestamp': string;
  uploadId?: string;
  channel: string;
  application: string;
  messageType: string;
  message: string;
  originFlow?: string;
  refId?: string;
  fingerprint: string;
  correlationId: string;
}
