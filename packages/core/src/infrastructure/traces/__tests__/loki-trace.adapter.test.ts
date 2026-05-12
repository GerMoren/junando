import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LokiTraceRepository, MockTraceRepository } from '../loki-trace.adapter.js';

describe('LokiTraceRepository', () => {
  const mockFetch = vi.fn();
  let repository: LokiTraceRepository;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    repository = new LokiTraceRepository('http://loki:3100', 'test-api-key');
  });

  it('fetches traces by trace ID and returns parsed results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          result: [
            {
              stream: { job: 'test-service' },
              values: [
                ['1715592000000000000', '{"level":"info","message":"trace started"}'],
                ['1715592001000000000', '{"level":"error","message":"trace failed"}'],
              ],
            },
          ],
        },
      }),
    });

    const result = await repository.findByTraceId('trace-123');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toContain('trace-123');
    expect(url).toContain('loki/api/v1/query_range');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    });

    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe('1715592000000000000');
    expect(result[0].level).toBe('info');
    expect(result[0].message).toBe('trace started');
    expect(result[1].timestamp).toBe('1715592001000000000');
    expect(result[1].level).toBe('error');
    expect(result[1].message).toBe('trace failed');
  });

  it('fetches traces without API key when not provided', async () => {
    const repoNoKey = new LokiTraceRepository('http://loki:3100');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { result: [] } }),
    });

    await repoNoKey.findByTraceId('trace-456');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
    });
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('throws error when response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(repository.findByTraceId('trace-123')).rejects.toThrow(
      'Loki query failed: 500 Internal Server Error',
    );
  });

  it('throws error when response status is 404', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(repository.findByTraceId('trace-123')).rejects.toThrow(
      'Loki query failed: 404 Not Found',
    );
  });

  it('parses non-JSON lines as plain message', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          result: [
            {
              stream: { job: 'test-service' },
              values: [
                ['1715592000000000000', 'plain log message without json'],
                ['1715592001000000000', 'another plain line'],
              ],
            },
          ],
        },
      }),
    });

    const result = await repository.findByTraceId('trace-123');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      timestamp: '1715592000000000000',
      message: 'plain log message without json',
    });
    expect(result[1]).toEqual({
      timestamp: '1715592001000000000',
      message: 'another plain line',
    });
  });

  it('handles empty results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { result: [] } }),
    });

    const result = await repository.findByTraceId('non-existent-trace');

    expect(result).toHaveLength(0);
  });

  it('handles multiple streams with multiple values', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          result: [
            {
              stream: { job: 'service-a' },
              values: [['1715592000000000000', '{"msg":"A1"}']],
            },
            {
              stream: { job: 'service-b' },
              values: [
                ['1715592001000000000', '{"msg":"B1"}'],
                ['1715592002000000000', '{"msg":"B2"}'],
              ],
            },
          ],
        },
      }),
    });

    const result = await repository.findByTraceId('trace-123');

    expect(result).toHaveLength(3);
    expect(result[0].msg).toBe('A1');
    expect(result[1].msg).toBe('B1');
    expect(result[2].msg).toBe('B2');
  });
});

describe('MockTraceRepository', () => {
  it('returns empty array when no fixtures are defined', async () => {
    const repository = new MockTraceRepository();
    const result = await repository.findByTraceId('trace-123');
    expect(result).toEqual([]);
  });

  it('returns configured fixture for trace ID', async () => {
    const repository = new MockTraceRepository();
    repository.addFixture('trace-123', [
      { timestamp: '1', level: 'info', message: 'test' },
      { timestamp: '2', level: 'error', message: 'fail' },
    ]);

    const result = await repository.findByTraceId('trace-123');

    expect(result).toHaveLength(2);
    expect(result[0].message).toBe('test');
    expect(result[1].message).toBe('fail');
  });

  it('returns different fixtures for different trace IDs', async () => {
    const repository = new MockTraceRepository();
    repository.addFixture('trace-1', [{ id: '1' }]);
    repository.addFixture('trace-2', [{ id: '2' }]);

    const result1 = await repository.findByTraceId('trace-1');
    const result2 = await repository.findByTraceId('trace-2');

    expect(result1).toHaveLength(1);
    expect(result1[0].id).toBe('1');
    expect(result2).toHaveLength(1);
    expect(result2[0].id).toBe('2');
  });

  it('overwrites existing fixture when adding new one with same trace ID', async () => {
    const repository = new MockTraceRepository();
    repository.addFixture('trace-123', [{ v: 'old' }]);
    repository.addFixture('trace-123', [{ v: 'new' }]);

    const result = await repository.findByTraceId('trace-123');

    expect(result).toHaveLength(1);
    expect(result[0].v).toBe('new');
  });

  it('accepts fixtures in constructor', async () => {
    const fixtures = new Map([['trace-123', [{ custom: 'data' }]]]);
    const repository = new MockTraceRepository(fixtures);

    const result = await repository.findByTraceId('trace-123');

    expect(result).toHaveLength(1);
    expect(result[0].custom).toBe('data');
  });
});