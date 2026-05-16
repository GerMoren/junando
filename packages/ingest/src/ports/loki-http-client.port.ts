/**
 * Loki HTTP client port.
 *
 * Defines the boundary between the ingest domain and the Loki infrastructure.
 * Concrete implementations (e.g. fetch-based LokiHttpClient) implement this
 * interface. Tests inject a vi.fn() implementation — no real HTTP needed.
 */

/**
 * Parameters for a Loki range query (`/loki/api/v1/query_range`).
 */
export interface LokiQueryParams {
  /** LogQL query string */
  query: string;
  /** Query window start, Unix nanoseconds */
  start: number;
  /** Query window end, Unix nanoseconds */
  end: number;
  /** Maximum number of log lines to return (default: 5000) */
  limit?: number;
}

/**
 * A single log stream returned by Loki.
 * `stream` contains the label set; `values` is an array of [nanosecond_ts, log_line].
 */
export interface LokiStreamResult {
  stream: Record<string, string>;
  values: Array<[string, string]>;
}

/**
 * Top-level Loki query response (`status: 'success'`).
 */
export interface LokiQueryResponse {
  status: 'success';
  data: {
    resultType: 'streams' | 'matrix' | 'vector';
    result: LokiStreamResult[];
  };
}

/**
 * Port: Loki HTTP client.
 *
 * The ingest domain depends on this interface, not on the fetch implementation.
 * This enables test doubles and future transport swaps without touching domain code.
 */
export interface ILokiHttpClient {
  /**
   * Execute a Loki range query and return the parsed response.
   *
   * @throws {LokiHttpError} on non-2xx HTTP responses
   * @throws {Error} on network failure or timeout (AbortSignal.timeout)
   */
  queryRange(params: LokiQueryParams): Promise<LokiQueryResponse>;
}

/**
 * Error thrown by LokiHttpClient when Loki returns a non-2xx response.
 */
export class LokiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Loki returned HTTP ${status}: ${body}`);
    this.name = 'LokiHttpError';
  }
}
