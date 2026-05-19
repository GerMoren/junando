#!/usr/bin/env tsx
/**
 * ingest-opensearch-smoke.ts
 * Quick smoke test for the OpenSearchIndexer adapter against a local instance.
 *
 * Usage:
 *   pnpm run ingest:opensearch:smoke
 *
 * Requires OpenSearch running at http://localhost:9200 (DISABLE_SECURITY_PLUGIN=true)
 * No SQS, no mapper, no .env needed — tests the adapter in isolation.
 */
import { createLogger } from '@junando/core';
import { OpenSearchIndexer } from '@junando/core';
import type { TraceabilityDocument } from '@junando/core';
import { createDefaultOpenSearchFetcher } from './ingest/factories/opensearch-fetcher.factory.js';

const ENDPOINT = 'http://localhost:9200';
const INDEX = 'junando-smoke-test';
const REGION = 'us-east-1';

const logger = createLogger();

logger.info({ endpoint: ENDPOINT, index: INDEX }, 'OpenSearch smoke test starting');

// ── 1. Build the indexer ────────────────────────────────────────────────────

const indexer = new OpenSearchIndexer({
  endpoint: ENDPOINT,
  indexName: INDEX,
  region: REGION,
  fetcher: createDefaultOpenSearchFetcher({
    region: REGION,
    // No signing for local dev (DISABLE_SECURITY_PLUGIN=true skips auth)
    skipSigning: true,
  }),
});

// ── 2. Index a test document ────────────────────────────────────────────────

const doc: TraceabilityDocument = {
  '@timestamp': new Date().toISOString(),
  uploadId: 'smoke-upload-001',
  channel: 'easy',
  application: 'importer',
  messageType: 'error',
  message: 'Smoke test — Product import failed',
  originFlow: 'catalog-sync',
  refId: 'ref-smoke-1',
  fingerprint: 'smoke-fp-' + Date.now(),
  correlationId: 'smoke-upload-001',
};

logger.info({ doc }, 'Indexing test document...');

await indexer.index(doc);

logger.info('Document indexed successfully.');

// ── 3. Verify it arrived ────────────────────────────────────────────────────

await new Promise((r) => setTimeout(r, 500)); // brief wait for indexing

const searchUrl = `${ENDPOINT}/${INDEX}/_search`;
const res = await fetch(searchUrl, {
  headers: { 'Content-Type': 'application/json' },
  method: 'POST',
  body: JSON.stringify({
    query: { match: { correlationId: doc.correlationId } },
  }),
});

if (!res.ok) {
  const body = await res.text();
  logger.error({ status: res.status, body }, 'Search request failed');
  process.exit(1);
}

const result = await res.json() as { hits: { total: { value: number }; hits: unknown[] } };
const count = result.hits.total.value;

if (count === 0) {
  logger.error('Document was NOT found in OpenSearch after indexing.');
  process.exit(1);
}

logger.info({ count, hits: result.hits.hits }, `✅ Smoke test passed — found ${count} document(s) in OpenSearch`);

// ── 4. Cleanup ──────────────────────────────────────────────────────────────

await fetch(`${ENDPOINT}/${INDEX}`, { method: 'DELETE' });
logger.info({ index: INDEX }, 'Cleanup done — index deleted');

process.exit(0);
