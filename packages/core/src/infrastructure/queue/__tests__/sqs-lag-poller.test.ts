import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @aws-sdk/client-sqs before importing the module under test
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: vi.fn(function() { return { send: mockSend }; }),
    GetQueueAttributesCommand: vi.fn(function(input) { return { input }; }),
  };
});

import { startSqsLagPoller } from '../sqs-lag-poller.js';
import * as metricsModule from '../../../shared/metrics/index.js';

describe('startSqsLagPoller', () => {
  let setSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setSpy = vi.spyOn(metricsModule.sqsQueueLag, 'set');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls sqsQueueLag.set with queue_name=alerts after interval fires', async () => {
    mockSend.mockResolvedValue({
      Attributes: { ApproximateNumberOfMessages: '42' },
    });

    const cleanup = startSqsLagPoller('https://sqs.test/queue/alerts', 15000);

    // Advance time to trigger one interval
    await vi.advanceTimersByTimeAsync(15000);

    expect(setSpy).toHaveBeenCalledWith({ queue_name: 'alerts' }, 42);
    cleanup();
  });

  it('does not reset gauge on SQS error (gauge retains last value)', async () => {
    // First call succeeds, sets gauge to 5
    mockSend
      .mockResolvedValueOnce({ Attributes: { ApproximateNumberOfMessages: '5' } })
      .mockRejectedValueOnce(new Error('SQS unavailable'));

    const cleanup = startSqsLagPoller('https://sqs.test/queue/alerts', 15000);

    await vi.advanceTimersByTimeAsync(15000); // first poll succeeds
    expect(setSpy).toHaveBeenCalledWith({ queue_name: 'alerts' }, 5);

    await vi.advanceTimersByTimeAsync(15000); // second poll errors — gauge should NOT be reset
    expect(setSpy).toHaveBeenCalledTimes(1); // only once (no second set call)

    cleanup();
  });

  it('returns a cleanup function that stops the interval', async () => {
    mockSend.mockResolvedValue({ Attributes: { ApproximateNumberOfMessages: '1' } });

    const cleanup = startSqsLagPoller('https://sqs.test/queue/alerts', 15000);
    cleanup();

    // After cleanup, advancing time should NOT trigger more polls
    await vi.advanceTimersByTimeAsync(30000);

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('does not throw when SQS errors — process stays alive', async () => {
    mockSend.mockRejectedValue(new Error('SQS unavailable'));

    const cleanup = startSqsLagPoller('https://sqs.test/queue/alerts', 15000);

    // Must not throw
    await expect(vi.advanceTimersByTimeAsync(15000)).resolves.not.toThrow();

    cleanup();
  });
});
