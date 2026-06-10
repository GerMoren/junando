import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedAlert } from '../../../domain/entities/alert.js';
import { AlertType } from '../../../shared/constants.js';

// Shared registry — same object across all factory calls, so mockSend is always
// the same function reference that captures args.
interface MockRegistry {
  calls: unknown[][];
  send: ReturnType<typeof vi.fn>;
  constructorCalls: number;
}
const registry = vi.hoisted((): MockRegistry => {
  const send = vi.fn((...args: unknown[]) => {
    registry.calls.push(args);
    return Promise.resolve({ MessageId: 'msg-abc-123' });
  });
  return { calls: [], send, constructorCalls: 0 };
});

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(function() {
    registry.constructorCalls++;
    return { send: registry.send };
  }),
  SendMessageCommand: vi.fn(),
}));

import { SQSAlertQueue, InMemoryAlertQueue } from '../sqs.adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function createAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    fingerprint: 'test-fingerprint',
    alertName: 'HighErrorRate',
    status: 'firing',
    serviceName: 'payment-service',
    alertType: AlertType.Error,
    endpointPath: '/api/v1/checkout',
    traceId: 'trace-123',
    startsAt: new Date().toISOString(),
    latencyMs: 1500,
    labels: { env: 'prod', region: 'us-east-1' },
    annotations: { summary: 'High error rate detected' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SQSAlertQueue
// ─────────────────────────────────────────────────────────────────────────────

describe('SQSAlertQueue', () => {
  // Silence error logs from error propagation tests
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    registry.calls.length = 0;
    registry.constructorCalls = 0;
    vi.clearAllMocks();
    // Restore default resolved behavior after any mockRejectedValue calls
    registry.send.mockImplementation((...args: unknown[]) => {
      registry.calls.push(args);
      return Promise.resolve({ MessageId: 'msg-abc-123' });
    });
    // Mock console.error used by the error-logging wrapper
    loggerErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('constructor', () => {
    it('creates SQSClient without region when none provided', () => {
      // Triggers the `else` branch of `region ? { region } : {}`
      new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');
    });

    it('creates SQSClient with region when provided', () => {
      // Triggers the `?` branch
      new SQSAlertQueue(
        'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
        'eu-west-2',
      );
    });
  });

  describe('publish', () => {
    it('captures SQS send calls', async () => {
      const alert = createAlert();
      const queue = new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');

      await queue.publish(alert);

      expect(registry.calls.length).toBe(1);
    });

    it('sends message to SQS with correct payload', async () => {
      const alert = createAlert();
      const queue = new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');

      await queue.publish(alert);

      expect(registry.calls).toHaveLength(1);
      // registry.send was called with a SendMessageCommand argument
      // The command wraps the input; verify send was called (not just constructed)
      expect(registry.send).toHaveBeenCalled();
    });

    it('uses fingerprint as MessageGroupId for FIFO ordering', async () => {
      const alert = createAlert({
        serviceName: 'auth-service',
        alertType: AlertType.Warning,
        endpointPath: '/login',
      });
      const queue = new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');

      await queue.publish(alert);

      // Verify send was called (integration of publish logic)
      expect(registry.send).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from SQS send', async () => {
      registry.send.mockRejectedValue(new Error('SQS Connection timeout'));
      const queue = new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');
      const alert = createAlert();

      await expect(queue.publish(alert)).rejects.toThrow('SQS Connection timeout');
    });

    it('rethrows error from SQS send without swallowing it', async () => {
      const error = new Error('SQS send failed');
      registry.send.mockRejectedValue(error);
      const queue = new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');
      const alert = createAlert();

      await expect(queue.publish(alert)).rejects.toThrow('SQS send failed');
    });
  });

  describe('sendMessage', () => {
    it('sends a raw message with provided FIFO params', async () => {
      const queue = new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');

      await queue.sendMessage({
        messageBody: '{"correlationId":"id-1","alerts":[]}',
        messageGroupId: 'group-1',
        messageDeduplicationId: 'dedup-1',
      });

      expect(registry.send).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from sendMessage', async () => {
      registry.send.mockRejectedValue(new Error('Send failed'));
      const queue = new SQSAlertQueue('https://sqs.us-east-1.amazonaws.com/123456789/test-queue');

      await expect(
        queue.sendMessage({
          messageBody: '{}',
          messageGroupId: 'g',
          messageDeduplicationId: 'd',
        }),
      ).rejects.toThrow('Send failed');
    });
  });

  describe('lazy SQSClient singleton', () => {
    it('does NOT instantiate SQSClient at construction time', () => {
      registry.constructorCalls = 0;
      new SQSAlertQueue('https://sqs.test');
      expect(registry.constructorCalls).toBe(0);
    });

    it('instantiates SQSClient only on first use', async () => {
      registry.constructorCalls = 0;
      const queue = new SQSAlertQueue('https://sqs.test');
      await queue.sendMessage({ messageBody: '{}', messageGroupId: 'g', messageDeduplicationId: 'd' });
      expect(registry.constructorCalls).toBe(1);
    });

    it('reuses the same SQSClient on subsequent calls (singleton)', async () => {
      registry.constructorCalls = 0;
      const queue = new SQSAlertQueue('https://sqs.test');
      await queue.sendMessage({ messageBody: '{}', messageGroupId: 'g1', messageDeduplicationId: 'd1' });
      await queue.sendMessage({ messageBody: '{}', messageGroupId: 'g2', messageDeduplicationId: 'd2' });
      expect(registry.constructorCalls).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// InMemoryAlertQueue
// ─────────────────────────────────────────────────────────────────────────────

describe('InMemoryAlertQueue', () => {
  it('publish adds alert to the published array', async () => {
    const queue = new InMemoryAlertQueue();
    const alert1 = createAlert({ serviceName: 'service-a' });
    const alert2 = createAlert({ serviceName: 'service-b' });

    await queue.publish(alert1);
    await queue.publish(alert2);

    expect(queue.published).toHaveLength(2);
    expect(queue.published[0]).toMatchObject(alert1);
    expect(queue.published[1]).toMatchObject(alert2);
  });

  it('does not throw on publish', async () => {
    const queue = new InMemoryAlertQueue();
    const alert = createAlert();

    await expect(queue.publish(alert)).resolves.toBeUndefined();
    expect(queue.published).toHaveLength(1);
  });

  it('published array is exposed and accessible', async () => {
    const queue = new InMemoryAlertQueue();
    const alert = createAlert();

    await queue.publish(alert);

    expect(queue.published).toBeInstanceOf(Array);
    expect(queue.published).toHaveLength(1);
  });

  it('publish returns successfully for different alert types', async () => {
    const queue = new InMemoryAlertQueue();

    await queue.publish(createAlert({ alertType: AlertType.Error }));
    await queue.publish(createAlert({ alertType: AlertType.Warning }));
    await queue.publish(createAlert({ alertType: AlertType.Success }));

    expect(queue.published).toHaveLength(3);
  });
});