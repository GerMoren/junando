import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RedisDeduplicationStore } from '../redis-dedup.adapter.js';

const REDIS_URL = 'redis://localhost:6379';
const DEDUP_TTL_SECONDS = 60;
let redis: InstanceType<typeof Redis>;
let store: RedisDeduplicationStore;
let fingerprint: string;

beforeAll(async () => {
  redis = new Redis(REDIS_URL, {
    connectTimeout: 5_000,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    throw new Error(`Redis is required for integration tests at ${REDIS_URL}: ${String(error)}`);
  }

  store = new RedisDeduplicationStore(redis);
});

afterEach(async () => {
  await store.reset(fingerprint);
});

afterAll(async () => {
  await redis.quit();
});

describe('RedisDeduplicationStore integration', () => {
  it('rejects a duplicate fingerprint in real Redis', async () => {
    fingerprint = `integration-test:${randomUUID()}`;

    await expect(store.isNew(fingerprint, DEDUP_TTL_SECONDS)).resolves.toEqual({
      isNew: true,
      ttlSeconds: DEDUP_TTL_SECONDS,
    });
    await expect(store.isNew(fingerprint, DEDUP_TTL_SECONDS)).resolves.toEqual({
      isNew: false,
      ttlSeconds: DEDUP_TTL_SECONDS,
    });
  });
});
