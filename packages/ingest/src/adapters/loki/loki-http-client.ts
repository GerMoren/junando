import type {
  ILokiHttpClient,
  LokiQueryParams,
  LokiQueryResponse,
} from '../../ports/loki-http-client.port.js';
import { LokiHttpError } from '../../ports/loki-http-client.port.js';

// ---------------------------------------------------------------------------
// Auth config types
// ---------------------------------------------------------------------------

export type LokiBearerAuth = { type: 'bearer'; tokenEnv: string };
export type LokiBasicAuth = { type: 'basic'; userEnv: string; passEnv: string };
export type LokiAuth = LokiBearerAuth | LokiBasicAuth;

export interface LokiHttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  auth?: LokiAuth;
}

// ---------------------------------------------------------------------------
// LokiHttpClient — fetch-based implementation of ILokiHttpClient
// ---------------------------------------------------------------------------

/**
 * Concrete Loki HTTP client that uses native `fetch` with `AbortSignal.timeout`.
 * Auth secrets are resolved from environment variables at call time — never stored
 * as literal values.
 *
 * NOT exported from the package barrel (`src/index.ts`).
 * Users wanting a custom transport should implement `ILokiHttpClient` directly.
 */
export class LokiHttpClient implements ILokiHttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly auth: LokiAuth | undefined;

  constructor(options: LokiHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.auth = options.auth;
  }

  async queryRange(params: LokiQueryParams): Promise<LokiQueryResponse> {
    const url = new URL(`${this.baseUrl}/loki/api/v1/query_range`);
    url.searchParams.set('query', params.query);
    url.searchParams.set('start', String(params.start));
    url.searchParams.set('end', String(params.end));
    if (params.limit !== undefined) {
      url.searchParams.set('limit', String(params.limit));
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const authHeader = this.buildAuthHeader();
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new LokiHttpError(response.status, body);
    }

    return (await response.json()) as LokiQueryResponse;
  }

  private buildAuthHeader(): string | null {
    if (!this.auth) return null;

    if (this.auth.type === 'bearer') {
      const token = process.env[this.auth.tokenEnv] ?? '';
      return `Bearer ${token}`;
    }

    if (this.auth.type === 'basic') {
      const user = process.env[this.auth.userEnv] ?? '';
      const pass = process.env[this.auth.passEnv] ?? '';
      const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
      return `Basic ${encoded}`;
    }

    return null;
  }
}
