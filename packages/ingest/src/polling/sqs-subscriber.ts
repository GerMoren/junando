import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import type { IIndexer, TraceabilityDocument } from '@junando/core';
import type { SqsIngestConfig } from '../config/ingest-config.schema.js';
import type { IMessageMapper } from '../mappers/registry.js';

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  error(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface SqsSubscriberObserver {
  onReceive?(count: number): void;
  onProcessSuccess?(count: number): void;
  onProcessFailure?(count: number): void;
  onDeleteSuccess?(count: number): void;
  setInFlight?(count: number): void;
  observePollDurationMs?(durationMs: number): void;
  onIndexSuccess?(message: Message, doc: TraceabilityDocument): void;
  onIndexFailure?(message: Message, error: unknown): void;
}

export interface SqsSubscriberDeps {
  config: SqsIngestConfig;
  processMessage: (message: Message) => Promise<void>;
  logger: Logger;
  sqsClient?: Pick<SQSClient, 'send'>;
  observer?: SqsSubscriberObserver;
  indexer?: IIndexer<TraceabilityDocument>;
  mapper?: IMessageMapper;
}

interface ProcessResult {
  message: Message;
  success: boolean;
}

export class SqsSubscriber {
  private readonly config: SqsIngestConfig['ingest']['sqs'];
  private readonly processMessage: (message: Message) => Promise<void>;
  private readonly logger: Logger;
  private readonly sqsClient: Pick<SQSClient, 'send'>;
  private readonly observer: SqsSubscriberObserver | undefined;
  private readonly indexer: IIndexer<TraceabilityDocument> | undefined;
  private readonly mapper: IMessageMapper | undefined;

  private loopPromise: Promise<void> | null = null;
  private readonly inFlight = new Set<Promise<ProcessResult>>();
  private readonly pendingBatches = new Set<Promise<void>>();
  private readonly capacityWaiters = new Set<() => void>();
  private receiveAbortController: AbortController | null = null;
  private stopping = false;

  constructor(deps: SqsSubscriberDeps) {
    if (deps.indexer && !deps.mapper) {
      throw new Error(
        'SqsSubscriber: indexer provided but mapper is missing. ' +
          'Both indexer and mapper must be supplied together.',
      );
    }

    this.config = deps.config.ingest.sqs;
    this.processMessage = deps.processMessage;
    this.logger = deps.logger;
    this.sqsClient =
      deps.sqsClient ??
      new SQSClient(this.config.endpointUrl ? { endpoint: this.config.endpointUrl } : {});
    this.observer = deps.observer;
    this.indexer = deps.indexer;
    this.mapper = deps.mapper;
  }

  start(): void {
    if (this.loopPromise) {
      return;
    }

    this.stopping = false;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.receiveAbortController?.abort();
    this.releaseCapacityWaiters();

    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }

    await Promise.allSettled(this.pendingBatches);
    await Promise.allSettled(this.inFlight);
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      const availableCapacity = this.config.maxInFlight - this.inFlight.size;
      if (availableCapacity <= 0) {
        await this.waitForCapacity();
        continue;
      }

      await this.pollOnce(Math.min(this.config.batchSize, availableCapacity, 10));
    }
  }

  private async pollOnce(maxMessages: number): Promise<void> {
    const startedAt = Date.now();
    const abortController = new AbortController();
    this.receiveAbortController = abortController;

    try {
      const response = await this.sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: this.config.queueUrl,
          WaitTimeSeconds: this.config.waitTimeSeconds,
          VisibilityTimeout: this.config.visibilityTimeoutSeconds,
          MaxNumberOfMessages: maxMessages,
        }),
        { abortSignal: abortController.signal },
      );

      const messages = response.Messages ?? [];
      if (messages.length === 0) {
        return;
      }

      this.observer?.onReceive?.(messages.length);
      this.trackBatch(this.processBatch(messages));
    } catch (err) {
      if (this.stopping && isAbortError(err)) {
        return;
      }

      this.logger.error({ err, step: 'receive' }, 'SQS receive failed');
    } finally {
      if (this.receiveAbortController === abortController) {
        this.receiveAbortController = null;
      }
      this.observer?.observePollDurationMs?.(Date.now() - startedAt);
    }
  }

  private trackBatch(task: Promise<void>): void {
    this.pendingBatches.add(task);

    void task.finally(() => {
      this.pendingBatches.delete(task);
      this.releaseCapacityWaiters();
    });
  }

  private async processBatch(messages: Message[]): Promise<void> {
    const tasks = messages.map((message) => this.trackProcess(this.processSingleMessage(message)));
    const results = await Promise.all(tasks);

    const successfulMessages = results.filter(
      (result): result is ProcessResult & { success: true } => result.success,
    );

    if (successfulMessages.length === 0) {
      return;
    }

    try {
      await this.sqsClient.send(
        new DeleteMessageBatchCommand({
          QueueUrl: this.config.queueUrl,
          Entries: successfulMessages.map((result, index) => ({
            Id: String(index),
            ReceiptHandle: result.message.ReceiptHandle ?? '',
          })),
        }),
      );
      this.observer?.onDeleteSuccess?.(successfulMessages.length);
    } catch (err) {
      const messageIds = successfulMessages.map((result) => result.message.MessageId ?? 'unknown');
      this.logger.error({ err, messageIds }, 'SQS delete failed');
    }
  }

  private trackProcess(task: Promise<ProcessResult>): Promise<ProcessResult> {
    this.inFlight.add(task);
    this.observer?.setInFlight?.(this.inFlight.size);

    return task.finally(() => {
      this.inFlight.delete(task);
      this.observer?.setInFlight?.(this.inFlight.size);
      this.releaseCapacityWaiters();
    });
  }

  private async processSingleMessage(message: Message): Promise<ProcessResult> {
    try {
      await this.processMessage(message);
      this.observer?.onProcessSuccess?.(1);
      await this.tryIndex(message);
      return { message, success: true };
    } catch (err) {
      this.observer?.onProcessFailure?.(1);
      this.logger.error(
        { err, step: 'processMessage', messageId: message.MessageId ?? 'unknown' },
        'SQS message processing failed',
      );
      return { message, success: false };
    }
  }

  private async tryIndex(message: Message): Promise<void> {
    if (!this.indexer || !this.mapper) {
      return;
    }

    try {
      const decoded = this.mapper.decode(message);
      const doc = this.mapper.toTraceabilityDocument(decoded, message);
      await this.indexer.index(doc);
      this.observer?.onIndexSuccess?.(message, doc);
    } catch (err) {
      this.logger.error(
        { err, step: 'index', messageId: message.MessageId ?? 'unknown' },
        'Indexing failed',
      );
      this.observer?.onIndexFailure?.(message, err);
    }
  }

  private async waitForCapacity(): Promise<void> {
    if (this.stopping || this.inFlight.size < this.config.maxInFlight) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.capacityWaiters.add(resolve);
    });
  }

  private releaseCapacityWaiters(): void {
    for (const resolve of this.capacityWaiters) {
      resolve();
    }
    this.capacityWaiters.clear();
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
