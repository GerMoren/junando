import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared registry — same object across all factory calls, so mockSend is always
// the same function reference that captures args.
interface MockRegistry {
  send: ReturnType<typeof vi.fn>;
  constructorCalls: number;
}
const registry = vi.hoisted((): MockRegistry => {
  return { send: vi.fn(), constructorCalls: 0 };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {
    registry.constructorCalls++;
    return { send: registry.send };
  }),
  PutItemCommand: vi.fn(function (input: unknown) {
    return { input };
  }),
  DeleteItemCommand: vi.fn(function (input: unknown) {
    return { input };
  }),
}));

vi.mock('../../../shared/logger/index.js', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })),
}));

import { DynamoDBDeduplicationStore } from '../dynamodb-dedup.adapter.js';
import { dedupFailoverTotal } from '../../../shared/metrics/index.js';

const FIXED_NOW_MS = 1_760_000_000_000;
const FIXED_NOW_SEC = 1_760_000_000;

describe('DynamoDBDeduplicationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW_MS);
    registry.send.mockReset();
    registry.constructorCalls = 0;
    vi.spyOn(dedupFailoverTotal, 'inc');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves { isNew: true, ttlSeconds } for a new fingerprint', async () => {
    registry.send.mockResolvedValueOnce({});
    const store = new DynamoDBDeduplicationStore('junando-dedup');

    const result = await store.isNew('fp-1', 300);

    expect(result).toEqual({ isNew: true, ttlSeconds: 300 });
  });

  it('sends the expiry-comparison ConditionExpression with the current epoch seconds', async () => {
    registry.send.mockResolvedValueOnce({});
    const store = new DynamoDBDeduplicationStore('junando-dedup');

    await store.isNew('fp-1', 300);

    const command = registry.send.mock.calls[0]?.[0];
    expect(command.input.ConditionExpression).toBe(
      'attribute_not_exists(fingerprint) OR expiresAt < :now',
    );
    expect(command.input.ExpressionAttributeValues[':now']).toEqual({ N: String(FIXED_NOW_SEC) });
  });

  it('writes expiresAt as a Number equal to now + ttlSeconds', async () => {
    registry.send.mockResolvedValueOnce({});
    const store = new DynamoDBDeduplicationStore('junando-dedup');

    await store.isNew('fp-1', 300);

    const command = registry.send.mock.calls[0]?.[0];
    expect(command.input.Item.expiresAt).toEqual({ N: String(FIXED_NOW_SEC + 300) });
  });

  it('treats a ConditionalCheckFailedException as a duplicate with no side effects', async () => {
    const conditionalError = new Error('condition failed');
    conditionalError.name = 'ConditionalCheckFailedException';
    registry.send.mockRejectedValueOnce(conditionalError);
    const store = new DynamoDBDeduplicationStore('junando-dedup');

    const result = await store.isNew('fp-1', 300);

    expect(result).toEqual({ isNew: false, ttlSeconds: 300 });
    expect(result).not.toHaveProperty('error');
    expect(dedupFailoverTotal.inc).not.toHaveBeenCalled();
  });

  it('fails open with error + counter + warn on any other store error', async () => {
    const genericError = new Error('network down');
    registry.send.mockRejectedValueOnce(genericError);
    const store = new DynamoDBDeduplicationStore('junando-dedup');

    const result = await store.isNew('fp-1', 300);

    expect(result).toEqual({ isNew: true, ttlSeconds: 300, error: 'network down' });
    expect(dedupFailoverTotal.inc).toHaveBeenCalledTimes(1);
  });

  it('reset() issues one DeleteItemCommand with the fingerprint key and resolves on an absent item', async () => {
    registry.send.mockResolvedValueOnce({});
    const store = new DynamoDBDeduplicationStore('junando-dedup');

    await expect(store.reset('fp-1')).resolves.toBeUndefined();

    expect(registry.send).toHaveBeenCalledTimes(1);
    const command = registry.send.mock.calls[0]?.[0];
    expect(command.input.Key).toEqual({ fingerprint: { S: 'fp-1' } });
  });

  it('builds the client lazily: none at construction, exactly one on first isNew, reused after', async () => {
    registry.send.mockResolvedValue({});
    const store = new DynamoDBDeduplicationStore('junando-dedup');

    expect(registry.constructorCalls).toBe(0);

    await store.isNew('fp-1', 300);
    expect(registry.constructorCalls).toBe(1);

    await store.isNew('fp-2', 300);
    expect(registry.constructorCalls).toBe(1);
  });
});
