import type { ITraceRepository } from '../../domain/ports/index.js';
import { HTTP_TIMEOUT_MS } from '../../shared/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// LokiTraceRepository — Infrastructure adapter.
// Implements ITraceRepository using Loki's HTTP query API.
// Swap for DatadogTraceRepository, JaegerTraceRepository, etc.
// ─────────────────────────────────────────────────────────────────────────────

export class LokiTraceRepository implements ITraceRepository {
  constructor(
    private readonly lokiUrl: string,
    private readonly apiKey?: string,
  ) {}

  async findByTraceId(traceId: string): Promise<Record<string, unknown>[]> {
    const query = encodeURIComponent(`{trace_id="${traceId}"}`);
    const url = `${this.lokiUrl}/loki/api/v1/query_range?query=${query}&limit=50`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.Default),
    });
    if (!res.ok) throw new Error(`Loki query failed: ${res.status} ${res.statusText}`);

    const body = (await res.json()) as LokiResponse;
    return this.parseResponse(body);
  }

  private parseResponse(body: LokiResponse): Record<string, unknown>[] {
    return body.data.result.flatMap((stream) =>
      stream.values.map(([ts, line]) => ({
        timestamp: ts,
        ...this.tryParseJSON(line),
      })),
    );
  }

  private tryParseJSON(line: string): Record<string, unknown> {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      return { message: line };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MockTraceRepository — Test adapter. Returns predictable fake traces.
// ─────────────────────────────────────────────────────────────────────────────

export class MockTraceRepository implements ITraceRepository {
  constructor(private readonly fixtures: Map<string, Record<string, unknown>[]> = new Map()) {}

  async findByTraceId(traceId: string): Promise<Record<string, unknown>[]> {
    return this.fixtures.get(traceId) ?? [];
  }

  addFixture(traceId: string, spans: Record<string, unknown>[]): void {
    this.fixtures.set(traceId, spans);
  }
}

// Internal types for Loki response shape
interface LokiResponse {
  data: {
    result: Array<{
      stream: Record<string, string>;
      values: Array<[string, string]>;
    }>;
  };
}
