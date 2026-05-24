/**
 * Prometheus HTTP client port.
 *
 * Defines the boundary between the ingest domain and the Prometheus HTTP
 * infrastructure. Concrete implementations use the global `fetch` API.
 * Tests inject a vi.fn() double — no real HTTP needed.
 */

/**
 * A single instant-query result entry from Prometheus.
 * `metric` contains the label set; `value` is [unixTimestamp, stringValue].
 */
export interface PrometheusInstantResult {
  metric: Record<string, string>;
  value: [number, string];
}

/**
 * Top-level Prometheus instant-query response (`/api/v1/query`).
 */
export interface PrometheusInstantResponse {
  status: 'success' | 'error';
  data: {
    resultType: 'vector';
    result: PrometheusInstantResult[];
  };
  errorType?: string;
  error?: string;
}

/**
 * Port: Prometheus HTTP client.
 *
 * The ingest adapters depend on this interface, not on the fetch implementation.
 * Method name `queryInstant` matches the spec requirement.
 */
export interface PrometheusHttpClientPort {
  /**
   * Execute a Prometheus instant query and return the parsed response.
   *
   * @param query - PromQL expression
   * @param time  - Optional evaluation timestamp in Unix seconds
   * @throws {PrometheusHttpError} on non-2xx HTTP responses
   * @throws {PrometheusParseError} on malformed JSON responses
   * @throws {MissingEnvError} if tokenEnv was configured but env var is absent
   */
  queryInstant(query: string, time?: number): Promise<PrometheusInstantResponse>;
}

/**
 * Error thrown when the configured token environment variable is absent at
 * construction time.
 */
export class MissingEnvError extends Error {
  constructor(public readonly envVar: string) {
    super(`Missing required environment variable: ${envVar}`);
    this.name = 'MissingEnvError';
  }
}

/**
 * Error thrown by PrometheusHttpClient when Prometheus returns a non-2xx response.
 */
export class PrometheusHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Prometheus returned HTTP ${status}: ${body}`);
    this.name = 'PrometheusHttpError';
  }
}

/**
 * Error thrown when the Prometheus response body cannot be parsed as JSON.
 */
export class PrometheusParseError extends Error {
  constructor(public readonly cause: unknown) {
    super(`Failed to parse Prometheus response as JSON`);
    this.name = 'PrometheusParseError';
  }
}
