import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@aws-sdk/client-sqs';
import type { TraceabilityDocument } from '../../../../packages/core/src/domain/entities/traceability.js';
import { InMemoryIndexer } from '../../../../packages/core/src/index.js';
import type { IMessageMapper } from '../../mappers/registry.js';
import { createSqsIndexerProcessor } from '../sqs-indexer.processor.js';

function makeDoc(overrides: Partial<TraceabilityDocument> = {}): TraceabilityDocument {
  return {
    '@timestamp': new Date().toISOString(),
    channel: 'easy',
    application: 'importer',
    messageType: 'error',
    message: 'Product import failed',
    fingerprint: 'fp-123',
    correlationId: 'corr-abc',
    ...overrides,
  };
}

function makeMapper(doc: TraceabilityDocument): IMessageMapper {
  return {
    kind: 'test-mapper',
    decode: vi.fn().mockReturnValue({}),
    toNormalizedAlerts: vi.fn().mockReturnValue([]),
    toTraceabilityDocument: vi.fn().mockReturnValue(doc),
    resolveCorrelationId: vi.fn().mockReturnValue('corr-abc'),
  };
}

function makeMessage(): Message {
  return { MessageId: 'msg-1', Body: '{}' };
}

describe('createSqsIndexerProcessor', () => {
  it('decodes the message, maps to TraceabilityDocument and indexes it', async () => {
    const doc = makeDoc({ correlationId: 'doc-id-1' });
    const mapper = makeMapper(doc);
    const indexer = new InMemoryIndexer();
    const processor = createSqsIndexerProcessor({ mapper, indexer });

    const msg = makeMessage();
    await processor(msg);

    expect(mapper.decode).toHaveBeenCalledWith(msg);
    const decoded = (mapper.decode as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(mapper.toTraceabilityDocument).toHaveBeenCalledWith(decoded, msg);
    expect(indexer.indexed).toHaveLength(1);
    expect(indexer.indexed[0]).toEqual(doc);
  });

  it('propagates indexer errors without swallowing them', async () => {
    const mapper = makeMapper(makeDoc());
    const failingIndexer = { index: vi.fn().mockRejectedValue(new Error('opensearch down')) };
    const processor = createSqsIndexerProcessor({ mapper, indexer: failingIndexer });

    await expect(processor(makeMessage())).rejects.toThrow(/opensearch down/);
    expect(failingIndexer.index).toHaveBeenCalledTimes(1);
  });

  it('propagates mapper decode errors without calling indexer', async () => {
    const mapper: IMessageMapper = {
      kind: 'test-mapper',
      decode: vi.fn().mockImplementation(() => { throw new Error('decode failed'); }),
      toNormalizedAlerts: vi.fn(),
      toTraceabilityDocument: vi.fn(),
      resolveCorrelationId: vi.fn(),
    };
    const indexer = { index: vi.fn() };
    const processor = createSqsIndexerProcessor({ mapper, indexer });

    await expect(processor(makeMessage())).rejects.toThrow(/decode failed/);
    expect(indexer.index).not.toHaveBeenCalled();
  });
});
