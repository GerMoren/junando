import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import type { SqsIngestConfig } from '../config/ingest-config.schema.js';

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface SqsSubscriberObserver {
  onReceive?(count: number): void;
  onProcessSuccess?(count: number): void;
  onProcessFailure?(count: number): void;
  onDeleteSuccess?(count: number): void;
  setInFlight?(count: number): void;
  observePollDurationMs?(durationMs: number): void;
}

export interface SqsSubscriberDeps {
  config: SqsIngestConfig;
  processMessage: (message: Message) => Promise<void>;
  logger: Logger;
  sqsClient?: Pick<SQSClient, 'send'>;
  observer?: SqsSubscriberObserver;
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

  private loopPromise: Promise<void> | null = null;
  private readonly inFlight = new Set<Promise<ProcessResult>>();
  private readonly pendingBatches = new Set<Promise<void>>();
  private readonly capacityWaiters = new Set<() => void>();
  private receiveAbortController: AbortController | null = null;
  private stopping = false;

  constructor(deps: SqsSubscriberDeps) {
    this.config = deps.config.ingest.sqs;
    this.processMessage = deps.processMessage;
    this.logger = deps.logger;
    this.sqsClient = deps.sqsClient ?? new SQSClient({});
    this.observer = deps.observer;
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

      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SQS receive failed: ${msg}`);
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
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`SQS delete failed: ${msg}`);
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
      return { message, success: true };
    } catch (err) {
      this.observer?.onProcessFailure?.(1);
      this.logger.error(
        `SQS message processing failed for ${message.MessageId ?? 'unknown'}: ${formatError(err)}`,
      );
      return { message, success: false };
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

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
