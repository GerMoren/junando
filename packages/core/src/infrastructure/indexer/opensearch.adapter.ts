import type { IIndexer } from '../../domain/ports/index.js';
import type { TraceabilityDocument } from '../../domain/entities/traceability.js';
export type { TraceabilityDocument };

// ─────────────────────────────────────────────────────────────────────────────
// Transport contract — an HTTP fetcher that performs the (already-prepared)
// request and returns a minimal response shape. Default implementation signs
// with SigV4; tests inject a stub.
// ─────────────────────────────────────────────────────────────────────────────
export interface SignedHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface OpenSearchHttpResponse {
  status: number;
  body: string;
}

export type OpenSearchHttpFetcher = (request: SignedHttpRequest) => Promise<OpenSearchHttpResponse>;

export interface OpenSearchIndexerDeps {
  endpoint: string;
  indexName: string;
  region: string;
  fetcher: OpenSearchHttpFetcher;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenSearchIndexer — Infrastructure adapter.
// Indexes a TraceabilityDocument into an OpenSearch domain.
// SigV4 signing is delegated to the injected fetcher so this class stays
// transport-agnostic and trivially testable.
// ─────────────────────────────────────────────────────────────────────────────
export class OpenSearchIndexer implements IIndexer<TraceabilityDocument> {
  private readonly endpoint: string;
  private readonly indexName: string;
  private readonly region: string;
  private readonly fetcher: OpenSearchHttpFetcher;

  constructor(deps: OpenSearchIndexerDeps) {
    this.endpoint = deps.endpoint.replace(/\/+$/, '');
    this.indexName = deps.indexName;
    this.region = deps.region;
    this.fetcher = deps.fetcher;
  }

  async index(doc: TraceabilityDocument): Promise<void> {
    const url = `${this.endpoint}/${this.indexName}/_doc`;
    const body = JSON.stringify(doc);

    const response = await this.fetcher({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/json',
      },
      body,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `OpenSearch index failed: status=${response.status} region=${this.region} body=${response.body}`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// InMemoryIndexer — Test/dev double.
// ─────────────────────────────────────────────────────────────────────────────
export class InMemoryIndexer implements IIndexer<TraceabilityDocument> {
  readonly indexed: TraceabilityDocument[] = [];

  async index(doc: TraceabilityDocument): Promise<void> {
    this.indexed.push(doc);
  }
}
