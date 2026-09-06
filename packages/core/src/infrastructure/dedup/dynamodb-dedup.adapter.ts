import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import type { DedupResult, IDeduplicationStore } from '../../domain/ports/index.js';
import { dedupFailoverTotal } from '../../shared/metrics/index.js';
import { createLogger } from '../../shared/logger/index.js';

const logger = createLogger();

const CONDITION_EXPRESSION = 'attribute_not_exists(fingerprint) OR expiresAt < :now';

// ─────────────────────────────────────────────────────────────────────────────
// DynamoDBDeduplicationStore — Infrastructure adapter.
// A single conditional PutItem is the whole dedup decision: correctness never
// depends on TTL deletion, which DynamoDB performs on a best-effort sweep and
// may defer for up to 48 hours. TTL is storage cleanup only.
// ─────────────────────────────────────────────────────────────────────────────

export class DynamoDBDeduplicationStore implements IDeduplicationStore {
  private client: DynamoDBClient | null = null;

  constructor(
    private readonly tableName: string,
    private readonly region?: string,
  ) {}

  private getClient(): DynamoDBClient {
    if (!this.client) {
      this.client = new DynamoDBClient(this.region ? { region: this.region } : {});
    }
    return this.client;
  }

  async isNew(fingerprint: string, ttlSeconds: number): Promise<DedupResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      await this.getClient().send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: {
            fingerprint: { S: fingerprint },
            expiresAt: { N: String(nowSec + ttlSeconds) },
          },
          ConditionExpression: CONDITION_EXPRESSION,
          ExpressionAttributeValues: { ':now': { N: String(nowSec) } },
        }),
      );
      return { isNew: true, ttlSeconds };
    } catch (err) {
      // Name check, not instanceof: under vi.mock the real error class is absent
      // from the module graph, so instanceof would not hold in the tests that
      // must prove this branch.
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
        return { isNew: false, ttlSeconds };
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err, fingerprint }, 'DynamoDB dedup check failed, failing open');
      dedupFailoverTotal.inc();
      return { isNew: true, ttlSeconds, error: message };
    }
  }

  async reset(fingerprint: string): Promise<void> {
    await this.getClient().send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: { fingerprint: { S: fingerprint } },
      }),
    );
  }
}
