import { randomUUID } from 'node:crypto';
import http, { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DynamoDBDeduplicationStore } from '../infrastructure/dedup/dynamodb-dedup.adapter.js';
import { MockLLMProvider } from '../infrastructure/llm/mock.provider.js';
import { MockTraceRepository } from '../infrastructure/traces/loki-trace.adapter.js';
import { ProcessIncidentUseCase } from '../application/use-cases/process-incident.use-case.js';
import type { NormalizedAlert } from '../domain/entities/alert.js';
import type { AlertCluster } from '../domain/entities/cluster.js';
import type { LLMAnalysis } from '../domain/entities/incident.js';
import type { INotifier, NotifyResult } from '../domain/ports/index.js';
import { NotifyOutcome } from '../domain/ports/index.js';
import { AlertType } from '../shared/constants.js';
import { createLogger } from '../shared/logger/index.js';

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
const TABLE_NAME = 'junando-dedup';
const DEDUP_TTL_SECONDS = 60;
const capturedRequests: string[] = [];
const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  request.on('end', () => {
    capturedRequests.push(body);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
});
let stubPort: number;
let store: DynamoDBDeduplicationStore;
let fingerprint: string;

class HttpCapturingNotifier implements INotifier {
  constructor(
    private readonly port: number,
    private readonly path: string,
  ) {}

  async send(cluster: AlertCluster, analysis: LLMAnalysis | null): Promise<NotifyResult> {
    await new Promise<void>((resolve, reject) => {
      const body = JSON.stringify({ cluster, analysis });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: this.path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    return { channels: ['integration-stub'], latencyMs: 0, outcome: NotifyOutcome.Success };
  }
}

beforeAll(async () => {
  process.env['AWS_ACCESS_KEY_ID'] = 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
  process.env['AWS_DEFAULT_REGION'] = 'us-east-1';
  process.env['AWS_ENDPOINT_URL'] = LOCALSTACK_ENDPOINT;
  store = new DynamoDBDeduplicationStore(TABLE_NAME, 'us-east-1');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP stub failed to listen');
  stubPort = address.port;
});

afterEach(async () => {
  capturedRequests.length = 0;
  await store.reset(fingerprint);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('ProcessIncidentUseCase integration', () => {
  it('uses DynamoDB deduplication and sends only the first event to the local HTTP notifier', async () => {
    // Unique serviceName per run → ClusteringService computes a unique fingerprint → no stale DynamoDB data.
    const uniqueService = `payments-${randomUUID()}`;
    fingerprint = uniqueService; // ClusteringService fingerprint ≈ SHA256(service|type|path); reset resets that exact key only if they match, but uniqueness prevents cross-run contamination.
    const alert: NormalizedAlert = {
      alertName: 'IntegrationAlert',
      alertType: AlertType.Error,
      annotations: {},
      endpointPath: '/checkout',
      fingerprint: uniqueService,
      labels: {},
      serviceName: uniqueService,
      startsAt: new Date().toISOString(),
      status: 'firing',
      traceId: 'trace-1',
    };
    const useCase = new ProcessIncidentUseCase({
      dedup: store,
      dedupTtlSeconds: DEDUP_TTL_SECONDS,
      llm: new MockLLMProvider(),
      logger: createLogger('silent'),
      notifier: new HttpCapturingNotifier(stubPort, '/slack'),
      traces: new MockTraceRepository(),
    });

    await useCase.execute([alert], randomUUID());
    await useCase.execute([alert], randomUUID());

    expect(capturedRequests).toHaveLength(1);
    expect(JSON.parse(capturedRequests[0] ?? '{}')).toMatchObject({
      cluster: { serviceName: uniqueService },
    });
  });
});
