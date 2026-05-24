import type { PrometheusHttpClientPort, PrometheusInstantResponse } from '../../ports/prometheus-http-client.port.js';
import {
  MissingEnvError,
  PrometheusHttpError,
  PrometheusParseError,
} from '../../ports/prometheus-http-client.port.js';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface PrometheusHttpClientOptions {
  /** Base URL of the Prometheus server, e.g. http://prometheus:9090 */
  baseUrl: string;
  /**
   * Name of the environment variable holding the bearer token.
   * When provided, the env var MUST be set at construction time or a
   * `MissingEnvError` is thrown immediately.
   */
  tokenEnv?: string;
  /** Request timeout in milliseconds (default: 10 000) */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// PrometheusHttpClient — fetch-based implementation of PrometheusHttpClientPort
// ---------------------------------------------------------------------------

/**
 * Standalone fetch-based Prometheus instant-query client.
 *
 * Intentionally does NOT import from LokiHttpClient utilities — adapters stay
 * independent per project convention.
 *
 * Auth token is resolved from the environment at construction time so that
 * misconfiguration fails fast (before the first poll).
 */
export class PrometheusHttpClient implements PrometheusHttpClientPort {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly token: string | undefined;

  constructor(options: PrometheusHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;

    if (options.tokenEnv !== undefined) {
      const value = process.env[options.tokenEnv];
      if (!value) {
        throw new MissingEnvError(options.tokenEnv);
      }
      this.token = value;
    }
  }

  async queryInstant(query: string, time?: number): Promise<PrometheusInstantResponse> {
    const url = new URL(`${this.baseUrl}/api/v1/query`);
    url.searchParams.set('query', query);
    if (time !== undefined) {
      url.searchParams.set('time', String(time));
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token !== undefined) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new PrometheusHttpError(response.status, body);
    }

    try {
      return (await response.json()) as PrometheusInstantResponse;
    } catch (cause) {
      throw new PrometheusParseError(cause);
    }
  }
}
