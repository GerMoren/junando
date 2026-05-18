import { describe, it, expect, vi, afterEach } from 'vitest';
import { LokiHttpClient } from '../loki-http-client.js';
import { LokiHttpError } from '../../../ports/loki-http-client.port.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARAMS = {
  query: '{service="api"} |= "ERROR"',
  start: 1_700_000_000_000_000_000,
  end: 1_700_000_060_000_000_000,
  limit: 100,
};

const LOKI_SUCCESS_RESPONSE = {
  status: 'success',
  data: {
    resultType: 'streams',
    result: [
      {
        stream: { service: 'api', level: 'error' },
        values: [['1700000000000000000', 'ERROR something broke']],
      },
    ],
  },
};

function makeFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function makeFetchError(status: number, bodyText = 'server error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve({}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LokiHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('happy path: returns parsed LokiQueryResponse on 200', async () => {
    vi.stubGlobal('fetch', makeFetchOk(LOKI_SUCCESS_RESPONSE));
    const client = new LokiHttpClient({ baseUrl: 'http://loki:3100' });
    const result = await client.queryRange(PARAMS);
    expect(result.status).toBe('success');
    expect(result.data.result).toHaveLength(1);
    expect(result.data.result[0]?.stream.service).toBe('api');
  });

  it('LKI-02-B: throws LokiHttpError on 5xx response', async () => {
    vi.stubGlobal('fetch', makeFetchError(500, 'internal error'));
    const client = new LokiHttpClient({ baseUrl: 'http://loki:3100' });
    await expect(client.queryRange(PARAMS)).rejects.toBeInstanceOf(LokiHttpError);
  });

  it('LKI-02-C: throws LokiHttpError on 4xx response with status', async () => {
    vi.stubGlobal('fetch', makeFetchError(400, 'bad query'));
    const client = new LokiHttpClient({ baseUrl: 'http://loki:3100' });
    const error = await client.queryRange(PARAMS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LokiHttpError);
    expect((error as LokiHttpError).status).toBe(400);
  });

  it('LKI-02-A: propagates timeout/network errors (AbortSignal.timeout)', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
    const client = new LokiHttpClient({ baseUrl: 'http://loki:3100', timeoutMs: 100 });
    await expect(client.queryRange(PARAMS)).rejects.toThrow();
  });

  it('LKI-03-A: sends Bearer Authorization header when auth type is bearer', async () => {
    vi.stubEnv('LOKI_TOKEN', 'my-test-token');
    const mockFetch = makeFetchOk(LOKI_SUCCESS_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);

    const client = new LokiHttpClient({
      baseUrl: 'http://loki:3100',
      auth: { type: 'bearer', tokenEnv: 'LOKI_TOKEN' },
    });
    await client.queryRange(PARAMS);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-test-token');
  });

  it('LKI-03-B: sends Basic Authorization header when auth type is basic', async () => {
    vi.stubEnv('LOKI_USER', 'admin');
    vi.stubEnv('LOKI_PASS', 'secret');
    const mockFetch = makeFetchOk(LOKI_SUCCESS_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);

    const client = new LokiHttpClient({
      baseUrl: 'http://loki:3100',
      auth: { type: 'basic', userEnv: 'LOKI_USER', passEnv: 'LOKI_PASS' },
    });
    await client.queryRange(PARAMS);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
    expect(headers['Authorization']).toBe(expected);
  });
});
