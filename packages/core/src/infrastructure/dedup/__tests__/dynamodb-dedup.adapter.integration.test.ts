import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DynamoDBDeduplicationStore } from '../dynamodb-dedup.adapter.js';

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
const TABLE_NAME = 'junando-dedup';
const DEDUP_TTL_SECONDS = 60;
let store: DynamoDBDeduplicationStore;
let fingerprint: string;

beforeAll(() => {
  process.env['AWS_ACCESS_KEY_ID'] = 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
  process.env['AWS_DEFAULT_REGION'] = 'us-east-1';
  process.env['AWS_ENDPOINT_URL'] = LOCALSTACK_ENDPOINT;
  store = new DynamoDBDeduplicationStore(TABLE_NAME, 'us-east-1');
});

afterEach(async () => {
  await store.reset(fingerprint);
});

describe('DynamoDBDeduplicationStore integration', () => {
  it('rejects a duplicate fingerprint in LocalStack DynamoDB', async () => {
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
