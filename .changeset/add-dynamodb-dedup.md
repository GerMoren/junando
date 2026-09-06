---
'@junando/core': minor
---

Adds `DynamoDBDeduplicationStore`, a store-agnostic `IDeduplicationStore` implementation backed by a
single conditional `PutItem` (`attribute_not_exists(fingerprint) OR expiresAt < :now`), and a new
`DEDUP_STORE` config selector (`dynamodb` — the AWS free-tier default — or `redis`). `redisUrl` is now
optional at the schema level; the active selector's required field is enforced via `superRefine` at
startup instead.

This is a **minor bump, not a patch**, because the fail-open failover counter is renamed from
`metrics.dedupRedisFailoverTotal` to `metrics.dedupFailoverTotal` now that it applies to any dedup
store, not just Redis. Existing consumers of the Redis metric name must update to the new name.

`DEDUP_STORE=redis` preserves the exact existing Redis dedup behaviour for the Helm chart and
`docker/docker-compose.prod.yml` targets — no manifest changes required.
