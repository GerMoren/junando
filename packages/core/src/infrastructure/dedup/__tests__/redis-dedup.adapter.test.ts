import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisDeduplicationStore } from '../redis-dedup.adapter.js';

describe('RedisDeduplicationStore', () => {
  const mockRedis = {
    set: vi.fn(),
    del: vi.fn(),
  };

  let store: RedisDeduplicationStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new RedisDeduplicationStore(mockRedis as any);
  });

  it('isNew: returns true and sets key with TTL when fingerprint is new', async () => {
    mockRedis.set.mockResolvedValue('OK');

    const result = await store.isNew('abc123', 300);

    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'junando:dedup:abc123',
      '1',
      'EX',
      300,
      'NX',
    );
  });

  it('isNew: returns false when fingerprint already exists', async () => {
    mockRedis.set.mockResolvedValue(null);

    const result = await store.isNew('abc123', 300);

    expect(result).toBe(false);
  });

  it('isNew: fails open when Redis throws', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis connection failed'));

    const result = await store.isNew('abc123', 300);

    expect(result).toBe(true); // fail open - treat as new
  });

  it('reset: deletes fingerprint key from Redis', async () => {
    mockRedis.del.mockResolvedValue(1);

    await store.reset('abc123');

    expect(mockRedis.del).toHaveBeenCalledWith('junando:dedup:abc123');
  });
});