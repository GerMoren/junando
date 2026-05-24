import { describe, it, expect, vi, afterEach } from 'vitest';
import { PrometheusHttpClient } from '../prometheus-http-client.js';
import {
  PrometheusHttpError,
  PrometheusParseError,
  MissingEnvError,
} from '../../../ports/prometheus-http-client.port.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUERY = 'http_requests_total{status="500"}';
const TIME_S = 1_700_000_000;

const SUCCESS_RESPONSE = {
  status: 'success' as const,
  data: {
    resultType: 'vector' as const,
    result: [
      {
        metric: { __name__: 'http_requests_total', status: '500' },
        value: [TIME_S, '42'],
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

function makeFetchError(status: number, bodyText = 'upstream error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(bodyText),
    json: () => Promise.reject(new Error('not json')),
  });
}

function makeFetchBadJson() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
    text: () => Promise.resolve('not json'),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrometheusHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // ── Scenario 1: Successful query returns parsed vector ──────────────────
  it('PROM-01: happy path — resolves with parsed PrometheusInstantResponse on 200', async () => {
    vi.stubGlobal('fetch', makeFetchOk(SUCCESS_RESPONSE));
    const client = new PrometheusHttpClient({ baseUrl: 'http://prometheus:9090' });

    const result = await client.queryInstant(QUERY, TIME_S);

    expect(result.status).toBe('success');
    expect(result.data.resultType).toBe('vector');
    expect(result.data.result).toHaveLength(1);
    expect(result.data.result[0]?.metric['status']).toBe('500');
    expect(result.data.result[0]?.value[1]).toBe('42');
  });

  // ── Scenario 2: Non-2xx upstream error is typed ──────────────────────────
  it('PROM-02: non-2xx response throws PrometheusHttpError with correct status', async () => {
    vi.stubGlobal('fetch', makeFetchError(500, 'internal server error'));
    const client = new PrometheusHttpClient({ baseUrl: 'http://prometheus:9090' });

    const err = await client.queryInstant(QUERY).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PrometheusHttpError);
    expect((err as PrometheusHttpError).status).toBe(500);
    expect((err as PrometheusHttpError).body).toContain('internal server error');
  });

  // ── Scenario 3: Malformed JSON error is typed ────────────────────────────
  it('PROM-03: malformed JSON throws PrometheusParseError distinct from HTTP error', async () => {
    vi.stubGlobal('fetch', makeFetchBadJson());
    const client = new PrometheusHttpClient({ baseUrl: 'http://prometheus:9090' });

    const err = await client.queryInstant(QUERY).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PrometheusParseError);
    expect(err).not.toBeInstanceOf(PrometheusHttpError);
  });

  // ── Scenario 4: tokenEnv unset — no Authorization header ─────────────────
  it('PROM-04: no tokenEnv — fetch is called without Authorization header', async () => {
    const mockFetch = makeFetchOk(SUCCESS_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);
    const client = new PrometheusHttpClient({ baseUrl: 'http://prometheus:9090' });

    await client.queryInstant(QUERY);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  // ── Scenario 5: tokenEnv set but env var missing → MissingEnvError ───────
  it('PROM-05: tokenEnv configured but env var absent — throws MissingEnvError at construction', () => {
    delete process.env['PROM_TOKEN'];

    expect(
      () => new PrometheusHttpClient({ baseUrl: 'http://prometheus:9090', tokenEnv: 'PROM_TOKEN' }),
    ).toThrow(MissingEnvError);
  });

  // ── Scenario 6: 401 response throws PrometheusHttpError ──────────────────
  it('PROM-06: 401 response throws PrometheusHttpError with status 401', async () => {
    vi.stubGlobal('fetch', makeFetchError(401, 'unauthorized'));
    const client = new PrometheusHttpClient({ baseUrl: 'http://prometheus:9090' });

    const err = await client.queryInstant(QUERY).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PrometheusHttpError);
    expect((err as PrometheusHttpError).status).toBe(401);
  });

  // ── Triangulation: tokenEnv present and env var set → Bearer header sent ─
  it('PROM-T1: tokenEnv configured and env var present — sends Bearer Authorization header', async () => {
    vi.stubEnv('PROM_TOKEN', 'super-secret-token');
    const mockFetch = makeFetchOk(SUCCESS_RESPONSE);
    vi.stubGlobal('fetch', mockFetch);

    const client = new PrometheusHttpClient({
      baseUrl: 'http://prometheus:9090',
      tokenEnv: 'PROM_TOKEN',
    });

    await client.queryInstant(QUERY);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer super-secret-token');
  });
});
