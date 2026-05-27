import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import type { IIndexer, TraceabilityDocument } from '@junando/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqsIngestConfig } from '../../config/ingest-config.schema.js';
import type { IMessageMapper } from '../../mappers/registry.js';
import { SqsSubscriber, type SqsSubscriberObserver } from '../sqs-subscriber.js';

interface MockRegistry {
  send: ReturnType<typeof vi.fn>;
  constructorCalls: number;
}

const registry = vi.hoisted(
  (): MockRegistry => ({
    send: vi.fn(),
    constructorCalls: 0,
  }),
);

vi.mock('@aws-sdk/client-sqs', async (importActual) => {
  const actual = await importActual<typeof import('@aws-sdk/client-sqs')>();
  return {
    ...actual,
    SQSClient: vi.fn(() => {
      registry.constructorCalls++;
      return { send: registry.send };
    }),
  };
});

function makeConfig(overrides: Partial<SqsIngestConfig['ingest']['sqs']> = {}): SqsIngestConfig {
  return {
    ingest: {
      kind: 'sqs',
      sqs: {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors',
        waitTimeSeconds: 20,
        visibilityTimeoutSeconds: 60,
        batchSize: 10,
        maxInFlight: 20,
        ...overrides,
      },
    },
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeObserver(): Required<SqsSubscriberObserver> {
  return {
    onReceive: vi.fn(),
    onProcessSuccess: vi.fn(),
    onProcessFailure: vi.fn(),
    onDeleteSuccess: vi.fn(),
    setInFlight: vi.fn(),
    observePollDurationMs: vi.fn(),
    onIndexSuccess: vi.fn(),
    onIndexFailure: vi.fn(),
  };
}

function makeIndexer(): { index: ReturnType<typeof vi.fn> } & IIndexer<TraceabilityDocument> {
  return { index: vi.fn().mockResolvedValue(undefined) };
}

function makeMapper(): IMessageMapper {
  const stubDoc: TraceabilityDocument = {
    correlationId: 'corr-1',
    fingerprint: 'fp-1',
    sourceSystem: 'test',
    timestamp: '2026-01-01T00:00:00.000Z',
    payload: {},
  };
  return {
    kind: 'test',
    decode: vi.fn().mockReturnValue({ raw: 'decoded' }),
    toNormalizedAlerts: vi.fn().mockReturnValue([]),
    toTraceabilityDocument: vi.fn().mockReturnValue(stubDoc),
    resolveCorrelationId: vi.fn().mockReturnValue('corr-1'),
  };
}

function makeMessage(id: string, receiptHandle = `receipt-${id}`): Message {
  return {
    MessageId: id,
    ReceiptHandle: receiptHandle,
    Body: JSON.stringify({ id }),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

describe('SqsSubscriber', () => {
  beforeEach(() => {
    registry.constructorCalls = 0;
    registry.send.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SQS-01: constructs a default SQSClient when no client is injected', () => {
    new SqsSubscriber({
      config: makeConfig(),
      processMessage: vi.fn().mockResolvedValue(undefined),
      logger: makeLogger(),
    });

    expect(SQSClient).toHaveBeenCalledWith({});
    expect(registry.constructorCalls).toBe(1);
  });

  it('SQS-01-B: passes endpoint override into the default SQSClient for local-dev queues', () => {
    new SqsSubscriber({
      config: makeConfig({ endpointUrl: 'http://localhost:4566' } as Partial<
        SqsIngestConfig['ingest']['sqs']
      >),
      processMessage: vi.fn().mockResolvedValue(undefined),
      logger: makeLogger(),
    });

    expect(SQSClient).toHaveBeenCalledWith({ endpoint: 'http://localhost:4566' });
    expect(registry.constructorCalls).toBe(1);
  });

  it('SQS-02: pollOnce uses configured receive params, hands raw messages to the processor, and deletes successes', async () => {
    const message = makeMessage('m-1');
    const logger = makeLogger();
    const observer = makeObserver();
    const sqsClient = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof ReceiveMessageCommand) {
          return { Messages: [message] };
        }

        if (command instanceof DeleteMessageBatchCommand) {
          return { Successful: [{ Id: '0' }] };
        }

        throw new Error('Unexpected command');
      }),
    };
    const processMessage = vi.fn().mockResolvedValue(undefined);

    const subscriber = new SqsSubscriber({
      config: makeConfig({ batchSize: 4, waitTimeSeconds: 15, visibilityTimeoutSeconds: 45 }),
      processMessage,
      logger,
      sqsClient: sqsClient as Pick<SQSClient, 'send'>,
      observer,
    });

    await (subscriber as unknown as { pollOnce(maxMessages: number): Promise<void> }).pollOnce(3);
    await flushMicrotasks();

    expect(sqsClient.send).toHaveBeenCalledTimes(2);

    const receive = sqsClient.send.mock.calls[0]?.[0];
    expect(receive).toBeInstanceOf(ReceiveMessageCommand);
    expect((receive as ReceiveMessageCommand).input).toMatchObject({
      QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors',
      WaitTimeSeconds: 15,
      VisibilityTimeout: 45,
      MaxNumberOfMessages: 3,
    });

    const del = sqsClient.send.mock.calls[1]?.[0];
    expect(del).toBeInstanceOf(DeleteMessageBatchCommand);
    expect((del as DeleteMessageBatchCommand).input).toMatchObject({
      QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/junando-errors',
      Entries: [{ Id: '0', ReceiptHandle: 'receipt-m-1' }],
    });

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(processMessage).toHaveBeenCalledWith(message);
    expect(observer.onReceive).toHaveBeenCalledWith(1);
    expect(observer.onProcessSuccess).toHaveBeenCalledWith(1);
    expect(observer.onDeleteSuccess).toHaveBeenCalledWith(1);
    expect(observer.setInFlight).toHaveBeenNthCalledWith(1, 1);
    expect(observer.setInFlight).toHaveBeenLastCalledWith(0);
    expect(observer.observePollDurationMs).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('SQS-03: mixed batch results delete only successful messages', async () => {
    const success = makeMessage('m-success', 'receipt-success');
    const failure = makeMessage('m-failure', 'receipt-failure');
    const logger = makeLogger();
    const observer = makeObserver();
    const sqsClient = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof ReceiveMessageCommand) {
          return { Messages: [success, failure] };
        }

        if (command instanceof DeleteMessageBatchCommand) {
          return { Successful: [{ Id: '0' }] };
        }

        throw new Error('Unexpected command');
      }),
    };
    const processMessage = vi.fn(async (message: Message) => {
      if (message.MessageId === 'm-failure') {
        throw new Error('boom');
      }
    });

    const subscriber = new SqsSubscriber({
      config: makeConfig({ batchSize: 2, maxInFlight: 2 }),
      processMessage,
      logger,
      sqsClient: sqsClient as Pick<SQSClient, 'send'>,
      observer,
    });

    await (subscriber as unknown as { pollOnce(maxMessages: number): Promise<void> }).pollOnce(2);
    await flushMicrotasks();

    expect(sqsClient.send).toHaveBeenCalledTimes(2);
    const del = sqsClient.send.mock.calls[1]?.[0] as DeleteMessageBatchCommand;
    expect(del.input).toMatchObject({
      Entries: [{ Id: '0', ReceiptHandle: 'receipt-success' }],
    });

    expect(observer.onProcessSuccess).toHaveBeenCalledWith(1);
    expect(observer.onProcessFailure).toHaveBeenCalledWith(1);
    expect(observer.onDeleteSuccess).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('SQS message processing failed for m-failure: boom'),
    );
  });

  it('SQS-04: skips delete when all messages fail', async () => {
    const first = makeMessage('m-1');
    const second = makeMessage('m-2');
    const logger = makeLogger();
    const sqsClient = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof ReceiveMessageCommand) {
          return { Messages: [first, second] };
        }

        throw new Error('Delete should not be attempted');
      }),
    };
    const processMessage = vi.fn().mockRejectedValue(new Error('bad payload'));

    const subscriber = new SqsSubscriber({
      config: makeConfig({ batchSize: 2 }),
      processMessage,
      logger,
      sqsClient: sqsClient as Pick<SQSClient, 'send'>,
    });

    await (subscriber as unknown as { pollOnce(maxMessages: number): Promise<void> }).pollOnce(2);
    await flushMicrotasks();

    expect(sqsClient.send).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('SQS message processing failed for m-1: bad payload'),
    );
  });

  it('SQS-05: honors maxInFlight gating before receiving additional work', async () => {
    const first = makeMessage('m-1');
    const second = makeMessage('m-2');
    const third = makeMessage('m-3');
    const firstDone = deferred<void>();
    const secondDone = deferred<void>();
    const thirdDone = deferred<void>();
    const receiveInputs: Array<Record<string, unknown>> = [];

    const sqsClient = {
      send: vi.fn((command: unknown, options?: { abortSignal?: AbortSignal }) => {
        if (command instanceof ReceiveMessageCommand) {
          receiveInputs.push({ ...(command as ReceiveMessageCommand).input });

          if (receiveInputs.length === 1) {
            return Promise.resolve({ Messages: [first, second] });
          }

          if (receiveInputs.length === 2) {
            return Promise.resolve({ Messages: [third] });
          }

          return new Promise((_, reject) => {
            options?.abortSignal?.addEventListener('abort', () => reject(createAbortError()), {
              once: true,
            });
          });
        }

        if (command instanceof DeleteMessageBatchCommand) {
          return Promise.resolve({ Successful: [{ Id: '0' }] });
        }

        return Promise.reject(new Error('Unexpected command'));
      }),
    };

    const processMessage = vi.fn((message: Message) => {
      switch (message.MessageId) {
        case 'm-1':
          return firstDone.promise;
        case 'm-2':
          return secondDone.promise;
        case 'm-3':
          return thirdDone.promise;
        default:
          return Promise.resolve();
      }
    });

    const subscriber = new SqsSubscriber({
      config: makeConfig({ batchSize: 2, maxInFlight: 2 }),
      processMessage,
      logger: makeLogger(),
      sqsClient: sqsClient as Pick<SQSClient, 'send'>,
    });

    subscriber.start();
    await flushMicrotasks();

    expect(receiveInputs).toHaveLength(1);
    expect(receiveInputs[0]).toMatchObject({ MaxNumberOfMessages: 2 });
    expect(processMessage).toHaveBeenCalledTimes(2);

    firstDone.resolve();
    await flushMicrotasks();

    expect(receiveInputs).toHaveLength(2);
    expect(receiveInputs[1]).toMatchObject({ MaxNumberOfMessages: 1 });
    expect(processMessage).toHaveBeenCalledWith(third);

    secondDone.resolve();
    thirdDone.resolve();
    await subscriber.stop();
  });

  it('SQS-06: stop aborts a long poll and drains in-flight work before resolving', async () => {
    const first = makeMessage('m-1');
    const firstDone = deferred<void>();
    let longPollAborted = false;

    const sqsClient = {
      send: vi.fn((command: unknown, options?: { abortSignal?: AbortSignal }) => {
        if (command instanceof ReceiveMessageCommand) {
          const receiveIndex = sqsClient.send.mock.calls.filter(
            ([calledCommand]) => calledCommand instanceof ReceiveMessageCommand,
          ).length;

          if (receiveIndex === 1) {
            return Promise.resolve({ Messages: [first] });
          }

          return new Promise((_, reject) => {
            options?.abortSignal?.addEventListener(
              'abort',
              () => {
                longPollAborted = true;
                reject(createAbortError());
              },
              { once: true },
            );
          });
        }

        if (command instanceof DeleteMessageBatchCommand) {
          return Promise.resolve({ Successful: [{ Id: '0' }] });
        }

        return Promise.reject(new Error('Unexpected command'));
      }),
    };

    const subscriber = new SqsSubscriber({
      config: makeConfig({ batchSize: 1, maxInFlight: 2 }),
      processMessage: vi.fn(() => firstDone.promise),
      logger: makeLogger(),
      sqsClient: sqsClient as Pick<SQSClient, 'send'>,
    });

    subscriber.start();
    await flushMicrotasks();

    const stopPromise = subscriber.stop();
    let stopResolved = false;
    void stopPromise.then(() => {
      stopResolved = true;
    });

    await flushMicrotasks();
    expect(longPollAborted).toBe(true);
    expect(stopResolved).toBe(false);

    firstDone.resolve();
    await stopPromise;
    expect(stopResolved).toBe(true);
  });

  describe('Indexer integration', () => {
    it('SQS-IDX-01: constructor throws when indexer is provided but mapper is absent', () => {
      const indexer = makeIndexer();
      expect(
        () =>
          new SqsSubscriber({
            config: makeConfig(),
            processMessage: vi.fn().mockResolvedValue(undefined),
            logger: makeLogger(),
            indexer,
          }),
      ).toThrow(/mapper/i);
    });

    it('SQS-IDX-02: constructor succeeds when both indexer and mapper are provided', () => {
      const indexer = makeIndexer();
      const mapper = makeMapper();
      expect(
        () =>
          new SqsSubscriber({
            config: makeConfig(),
            processMessage: vi.fn().mockResolvedValue(undefined),
            logger: makeLogger(),
            indexer,
            mapper,
          }),
      ).not.toThrow();
    });

    it('SQS-IDX-03: no indexer provided — baseline behavior unchanged', async () => {
      const message = makeMessage('m-1');
      const sqsClient = {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof ReceiveMessageCommand) return { Messages: [message] };
          if (command instanceof DeleteMessageBatchCommand) return { Successful: [{ Id: '0' }] };
          throw new Error('Unexpected command');
        }),
      };
      const processMessage = vi.fn().mockResolvedValue(undefined);

      const subscriber = new SqsSubscriber({
        config: makeConfig(),
        processMessage,
        logger: makeLogger(),
        sqsClient: sqsClient as Pick<SQSClient, 'send'>,
      });

      await (subscriber as unknown as { pollOnce(n: number): Promise<void> }).pollOnce(1);
      await flushMicrotasks();

      expect(processMessage).toHaveBeenCalledWith(message);
      expect(sqsClient.send).toHaveBeenCalledTimes(2);
    });

    it('SQS-IDX-04: happy path — decode → toTraceabilityDocument → index called; onIndexSuccess emitted', async () => {
      const message = makeMessage('m-1');
      const indexer = makeIndexer();
      const mapper = makeMapper();
      const observer = makeObserver();
      const sqsClient = {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof ReceiveMessageCommand) return { Messages: [message] };
          if (command instanceof DeleteMessageBatchCommand) return { Successful: [{ Id: '0' }] };
          throw new Error('Unexpected command');
        }),
      };

      const subscriber = new SqsSubscriber({
        config: makeConfig(),
        processMessage: vi.fn().mockResolvedValue(undefined),
        logger: makeLogger(),
        sqsClient: sqsClient as Pick<SQSClient, 'send'>,
        observer,
        indexer,
        mapper,
      });

      await (subscriber as unknown as { pollOnce(n: number): Promise<void> }).pollOnce(1);
      await flushMicrotasks();

      expect(mapper.decode).toHaveBeenCalledWith(message);
      expect(mapper.toTraceabilityDocument).toHaveBeenCalledWith({ raw: 'decoded' }, message);
      expect(indexer.index).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'corr-1' }),
      );
      expect(observer.onIndexSuccess).toHaveBeenCalledWith(
        message,
        expect.objectContaining({ correlationId: 'corr-1' }),
      );
    });

    it('SQS-IDX-05: processMessage fails — indexer.index is NOT called', async () => {
      const message = makeMessage('m-1');
      const indexer = makeIndexer();
      const mapper = makeMapper();
      const sqsClient = {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof ReceiveMessageCommand) return { Messages: [message] };
          throw new Error('Should not delete');
        }),
      };

      const subscriber = new SqsSubscriber({
        config: makeConfig(),
        processMessage: vi.fn().mockRejectedValue(new Error('process failed')),
        logger: makeLogger(),
        sqsClient: sqsClient as Pick<SQSClient, 'send'>,
        indexer,
        mapper,
      });

      await (subscriber as unknown as { pollOnce(n: number): Promise<void> }).pollOnce(1);
      await flushMicrotasks();

      expect(indexer.index).not.toHaveBeenCalled();
    });

    it('SQS-IDX-06: indexer.index throws — logger.warn called, onIndexFailure emitted, message still deleted', async () => {
      const message = makeMessage('m-1');
      const indexError = new Error('index failed');
      const indexer = makeIndexer();
      (indexer.index as ReturnType<typeof vi.fn>).mockRejectedValue(indexError);
      const mapper = makeMapper();
      const observer = makeObserver();
      const logger = makeLogger();
      const sqsClient = {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof ReceiveMessageCommand) return { Messages: [message] };
          if (command instanceof DeleteMessageBatchCommand) return { Successful: [{ Id: '0' }] };
          throw new Error('Unexpected command');
        }),
      };

      const subscriber = new SqsSubscriber({
        config: makeConfig(),
        processMessage: vi.fn().mockResolvedValue(undefined),
        logger,
        sqsClient: sqsClient as Pick<SQSClient, 'send'>,
        observer,
        indexer,
        mapper,
      });

      await (subscriber as unknown as { pollOnce(n: number): Promise<void> }).pollOnce(1);
      await flushMicrotasks();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('index failed'));
      expect(observer.onIndexFailure).toHaveBeenCalledWith(message, indexError);
      // message should still be deleted (DeleteMessageBatchCommand was sent)
      const deleteSent = sqsClient.send.mock.calls.some(
        ([cmd]) => cmd instanceof DeleteMessageBatchCommand,
      );
      expect(deleteSent).toBe(true);
    });

    it('SQS-IDX-07: observer without onIndexSuccess/onIndexFailure hooks — no throw', async () => {
      const message = makeMessage('m-1');
      const indexer = makeIndexer();
      const mapper = makeMapper();
      const sqsClient = {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof ReceiveMessageCommand) return { Messages: [message] };
          if (command instanceof DeleteMessageBatchCommand) return { Successful: [{ Id: '0' }] };
          throw new Error('Unexpected command');
        }),
      };
      // observer without index hooks
      const observer: SqsSubscriberObserver = {
        onReceive: vi.fn(),
        onProcessSuccess: vi.fn(),
      };

      const subscriber = new SqsSubscriber({
        config: makeConfig(),
        processMessage: vi.fn().mockResolvedValue(undefined),
        logger: makeLogger(),
        sqsClient: sqsClient as Pick<SQSClient, 'send'>,
        observer,
        indexer,
        mapper,
      });

      await expect(
        (subscriber as unknown as { pollOnce(n: number): Promise<void> }).pollOnce(1),
      ).resolves.not.toThrow();
      await flushMicrotasks();
    });
  });
});
