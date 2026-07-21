import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RedisDeduplicationStore,
  InMemoryDeduplicationStore,
} from '../redis-dedup.adapter.js';

describe('RedisDeduplicationStore', () => {
  const mockRedis = {
    set: vi.fn(),
    del: vi.fn(),
  };

  let store: RedisDeduplicationStore;
  // Silence warn logs from fail-open behavior
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new RedisDeduplicationStore(mockRedis as any);
    // Mock the module-level logger used by RedisDeduplicationStore
    loggerWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerWarnSpy.mockRestore();
  });

  it('isNew: returns structured result with isNew=true and ttlSeconds when fingerprint is new', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const result = await store.isNew('abc123', 300);

    expect(result).toEqual({ isNew: true, ttlSeconds: 300 });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'junando:dedup:abc123',
      '1',
      'EX',
      300,
      'NX',
    );
  });

  it('isNew: returns structured result with isNew=false when fingerprint already exists', async () => {
    mockRedis.set.mockResolvedValue(null);

    const result = await store.isNew('abc123', 300);

    expect(result).toEqual({ isNew: false, ttlSeconds: 300 });
  });

  it('isNew: fails open with error info when Redis throws', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis connection failed'));

    const result = await store.isNew('abc123', 300);

    // Fail open: Redis down → treat every alert as new (noisy but safe),
    // but expose the failure so the wide event can record it.
    expect(result.isNew).toBe(true);
    expect(result.ttlSeconds).toBe(300);
    expect(result.error).toBe('Redis connection failed');
  });

  it('isNew: omits error field on the happy path', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const result = await store.isNew('abc123', 300);

    expect(result.error).toBeUndefined();
  });

  it('reset: deletes fingerprint key from Redis', async () => {
    mockRedis.del.mockResolvedValue(1);

    await store.reset('abc123');

    expect(mockRedis.del).toHaveBeenCalledWith('junando:dedup:abc123');
  });
});

describe('InMemoryDeduplicationStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('isNew: returns structured result with isNew=true for an unseen fingerprint', async () => {
    const store = new InMemoryDeduplicationStore();

    const result = await store.isNew('fp-1', 300);

    expect(result).toEqual({ isNew: true, ttlSeconds: 300 });
  });

  it('isNew: returns isNew=false for a fingerprint seen within the TTL window', async () => {
    const store = new InMemoryDeduplicationStore();

    const first = await store.isNew('fp-1', 300);
    const second = await store.isNew('fp-1', 300);

    expect(first.isNew).toBe(true);
    expect(second).toEqual({ isNew: false, ttlSeconds: 300 });
  });

  it('isNew: returns isNew=true again after the TTL window expires', async () => {
    vi.useFakeTimers();
    const store = new InMemoryDeduplicationStore();

    const first = await store.isNew('fp-1', 60);
    vi.advanceTimersByTime(61_000);
    const second = await store.isNew('fp-1', 60);

    expect(first.isNew).toBe(true);
    expect(second).toEqual({ isNew: true, ttlSeconds: 60 });
  });

  it('isNew: never exposes an error field (no external dependency to fail)', async () => {
    const store = new InMemoryDeduplicationStore();

    const result = await store.isNew('fp-1', 300);

    expect(result.error).toBeUndefined();
  });
});
