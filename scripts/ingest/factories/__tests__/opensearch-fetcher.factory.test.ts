import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal local type covering what we inspect from the HttpRequest passed to
// SignatureV4.sign(). Avoids importing @smithy/types (unlisted dep).
// ─────────────────────────────────────────────────────────────────────────────
interface CapturedHttpRequest {
  method: string;
  hostname: string;
  port?: number;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock @smithy/signature-v4 so SignatureV4.sign() returns its input unchanged.
// ─────────────────────────────────────────────────────────────────────────────
const mockSign = vi.fn().mockImplementation((req: CapturedHttpRequest) => Promise.resolve(req));

vi.mock('@smithy/signature-v4', () => ({
  SignatureV4: vi.fn(function() { return { sign: mockSign }; }),
}));

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn().mockReturnValue(() =>
    Promise.resolve({ accessKeyId: 'test', secretAccessKey: 'test', sessionToken: 'test' }),
  ),
}));

import { createDefaultOpenSearchFetcher } from '../opensearch-fetcher.factory.js';

function makeFetchImpl(status = 200, body = '{"result":"ok"}') {
  return vi.fn().mockResolvedValue({
    status,
    text: () => Promise.resolve(body),
  });
}

describe('createDefaultOpenSearchFetcher', () => {
  beforeEach(() => {
    mockSign.mockClear();
  });

  it('S-1-A: host header equals url.host for standard HTTPS (port 443)', async () => {
    const fetchImpl = makeFetchImpl();
    const fetcher = createDefaultOpenSearchFetcher({ region: 'us-east-1', fetchImpl });

    await fetcher({
      method: 'POST',
      url: 'https://search.example.com/my-index/_doc',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(mockSign).toHaveBeenCalledTimes(1);
    const req = mockSign.mock.calls[0]?.[0] as CapturedHttpRequest;
    expect(req.headers['host']).toBe('search.example.com');
  });

  it('S-1-B: host header includes the port for a non-standard port', async () => {
    const fetchImpl = makeFetchImpl();
    const fetcher = createDefaultOpenSearchFetcher({ region: 'us-east-1', fetchImpl });

    await fetcher({
      method: 'POST',
      url: 'https://search.example.com:9200/my-index/_doc',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(mockSign).toHaveBeenCalledTimes(1);
    const req = mockSign.mock.calls[0]?.[0] as CapturedHttpRequest;
    expect(req.headers['host']).toBe('search.example.com:9200');
  });

  it('S-1-C: path includes the query string', async () => {
    const fetchImpl = makeFetchImpl();
    const fetcher = createDefaultOpenSearchFetcher({ region: 'us-east-1', fetchImpl });

    await fetcher({
      method: 'GET',
      url: 'https://search.example.com/my-index/_search?pretty=true&size=10',
      headers: {},
      body: '',
    });

    expect(mockSign).toHaveBeenCalledTimes(1);
    const req = mockSign.mock.calls[0]?.[0] as CapturedHttpRequest;
    expect(req.path).toBe('/my-index/_search?pretty=true&size=10');
  });

  it('S-1-D: port property is absent (undefined) for default HTTPS port 443', async () => {
    const fetchImpl = makeFetchImpl();
    const fetcher = createDefaultOpenSearchFetcher({ region: 'us-east-1', fetchImpl });

    await fetcher({
      method: 'POST',
      url: 'https://search.example.com/my-index/_doc',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    const req = mockSign.mock.calls[0]?.[0] as CapturedHttpRequest;
    expect(req.port).toBeUndefined();
  });
});
