import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryIndexer,
  OpenSearchIndexer,
  type OpenSearchHttpFetcher,
  type SignedHttpRequest,
  type TraceabilityDocument,
} from '../opensearch.adapter.js';

function makeDoc(overrides: Partial<TraceabilityDocument> = {}): TraceabilityDocument {
  return {
    '@timestamp': '2026-05-19T12:00:00.000Z',
    channel: 'easy',
    application: 'importer',
    messageType: 'error',
    message: 'Product import failed',
    fingerprint: 'fp-123',
    correlationId: 'corr-abc',
    ...overrides,
  };
}

describe('InMemoryIndexer', () => {
  it('captures indexed documents in order', async () => {
    const indexer = new InMemoryIndexer();
    const doc1 = makeDoc({ correlationId: 'a' });
    const doc2 = makeDoc({ correlationId: 'b' });

    await indexer.index(doc1);
    await indexer.index(doc2);

    expect(indexer.indexed).toHaveLength(2);
    expect(indexer.indexed[0]).toEqual(doc1);
    expect(indexer.indexed[1]).toEqual(doc2);
  });
});

describe('OpenSearchIndexer', () => {
  function makeFetcher(response: { status: number; body?: string } = { status: 201 }) {
    const fetcher: OpenSearchHttpFetcher = vi
      .fn()
      .mockResolvedValue({ status: response.status, body: response.body ?? '' });
    return fetcher as ReturnType<typeof vi.fn> & OpenSearchHttpFetcher;
  }

  it('POSTs the document as JSON to {endpoint}/{indexName}/_doc', async () => {
    const fetcher = makeFetcher();
    const indexer = new OpenSearchIndexer({
      endpoint: 'https://search.example.com',
      indexName: 'cenco-traceability',
      region: 'us-east-1',
      fetcher,
    });

    const doc = makeDoc({ uploadId: 'upload-1' });
    await indexer.index(doc);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SignedHttpRequest;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://search.example.com/cenco-traceability/_doc');
    expect(request.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request.body)).toEqual(doc);
  });

  it('strips a trailing slash from the endpoint when composing the URL', async () => {
    const fetcher = makeFetcher();
    const indexer = new OpenSearchIndexer({
      endpoint: 'https://search.example.com/',
      indexName: 'cenco-traceability',
      region: 'us-east-1',
      fetcher,
    });

    await indexer.index(makeDoc());

    const request = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SignedHttpRequest;
    expect(request.url).toBe('https://search.example.com/cenco-traceability/_doc');
  });

  it('throws when the OpenSearch response status is not 2xx', async () => {
    const fetcher = makeFetcher({ status: 403, body: 'forbidden' });
    const indexer = new OpenSearchIndexer({
      endpoint: 'https://search.example.com',
      indexName: 'cenco-traceability',
      region: 'us-east-1',
      fetcher,
    });

    await expect(indexer.index(makeDoc())).rejects.toThrow(/opensearch index failed.*403/i);
  });

  it('treats any 2xx response as success (200 and 201)', async () => {
    const fetcher200 = makeFetcher({ status: 200 });
    await new OpenSearchIndexer({
      endpoint: 'https://search.example.com',
      indexName: 'idx',
      region: 'us-east-1',
      fetcher: fetcher200,
    }).index(makeDoc());

    const fetcher201 = makeFetcher({ status: 201 });
    await new OpenSearchIndexer({
      endpoint: 'https://search.example.com',
      indexName: 'idx',
      region: 'us-east-1',
      fetcher: fetcher201,
    }).index(makeDoc());

    expect(fetcher200).toHaveBeenCalledTimes(1);
    expect(fetcher201).toHaveBeenCalledTimes(1);
  });

  it('serializes optional fields (uploadId, refId, originFlow) when present', async () => {
    const fetcher = makeFetcher();
    const indexer = new OpenSearchIndexer({
      endpoint: 'https://search.example.com',
      indexName: 'idx',
      region: 'us-east-1',
      fetcher,
    });

    const doc = makeDoc({
      uploadId: 'u-1',
      refId: 'ref-1',
      originFlow: 'catalog-sync',
    });
    await indexer.index(doc);

    const request = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SignedHttpRequest;
    const sent = JSON.parse(request.body);
    expect(sent.uploadId).toBe('u-1');
    expect(sent.refId).toBe('ref-1');
    expect(sent.originFlow).toBe('catalog-sync');
  });

  it('omits optional fields from the serialized document when absent', async () => {
    const fetcher = makeFetcher();
    const indexer = new OpenSearchIndexer({
      endpoint: 'https://search.example.com',
      indexName: 'idx',
      region: 'us-east-1',
      fetcher,
    });

    await indexer.index(makeDoc());

    const request = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SignedHttpRequest;
    const sent = JSON.parse(request.body);
    expect(sent).not.toHaveProperty('uploadId');
    expect(sent).not.toHaveProperty('refId');
    expect(sent).not.toHaveProperty('originFlow');
  });
});
