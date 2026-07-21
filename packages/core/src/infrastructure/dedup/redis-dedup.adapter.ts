import type { Redis } from 'ioredis';
import type { DedupResult, IDeduplicationStore } from '../../domain/ports/index.js';
import { dedupRedisFailoverTotal } from '../../shared/metrics/index.js';
import { createLogger } from '../../shared/logger/index.js';

const logger = createLogger();

// ─────────────────────────────────────────────────────────────────────────────
// RedisDeduplicationStore — Infrastructure adapter.
// Implements IDeduplicationStore using Redis SET NX.
// Swap this for DynamoDBDeduplicationStore or InMemoryDeduplicationStore
// without touching a single line of domain or application code.
// ─────────────────────────────────────────────────────────────────────────────

export class RedisDeduplicationStore implements IDeduplicationStore {
  private readonly keyPrefix = 'junando:dedup:';

  constructor(private readonly redis: Redis) {}

  async isNew(fingerprint: string, ttlSeconds: number): Promise<DedupResult> {
    try {
      const result = await this.redis.set(
        `${this.keyPrefix}${fingerprint}`,
        '1',
        'EX',
        ttlSeconds,
        'NX',
      );
      return { isNew: result === 'OK', ttlSeconds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err, fingerprint }, 'Redis dedup check failed, failing open');
      dedupRedisFailoverTotal.inc();
      // Fail open: Redis down → treat every alert as new (noisy but safe).
      // The error rides the result so the wide event can record the failover.
      return { isNew: true, ttlSeconds, error: message };
    }
  }

  async reset(fingerprint: string): Promise<void> {
    await this.redis.del(`${this.keyPrefix}${fingerprint}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// InMemoryDeduplicationStore — Test adapter.
// Zero dependencies. Use in unit tests and local dev without Redis.
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryDeduplicationStore implements IDeduplicationStore {
  private readonly store = new Map<string, number>(); // fingerprint → expiry timestamp

  async isNew(fingerprint: string, ttlSeconds: number): Promise<DedupResult> {
    const expiry = this.store.get(fingerprint);
    const now = Date.now();

    if (expiry !== undefined && expiry > now) {
      return { isNew: false, ttlSeconds };
    }

    this.store.set(fingerprint, now + ttlSeconds * 1000);
    return { isNew: true, ttlSeconds };
  }

  async reset(fingerprint: string): Promise<void> {
    this.store.delete(fingerprint);
  }

  clear(): void {
    this.store.clear();
  }
}
